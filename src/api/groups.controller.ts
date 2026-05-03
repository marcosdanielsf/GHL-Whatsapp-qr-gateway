import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { getSocket, getConnectionStatus } from "../core/baileys";
import { logger } from "../utils/logger";

export const groupsRouter = Router();

groupsRouter.use(requireAuth);

const scoped = (tenantId: string, instanceId: string) =>
  `${tenantId}-${instanceId}`;

/**
 * GET /api/wa/groups/list?instanceId=wa-01
 * Lista todos os grupos que o chip participa.
 * Espelha Baileys `sock.groupFetchAllParticipating()`.
 */
groupsRouter.get("/list", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res
        .status(400)
        .json({ success: false, error: "Tenant ID missing" });
    }

    const instanceId = (req.query.instanceId as string) || "";
    if (!instanceId) {
      return res
        .status(400)
        .json({ success: false, error: "Query param 'instanceId' is required" });
    }

    const scopedId = scoped(tenantId, instanceId);

    if (getConnectionStatus(scopedId) !== "ONLINE") {
      return res.status(400).json({
        success: false,
        error: `Instance ${instanceId} is not connected`,
      });
    }

    const sock = getSocket(scopedId);
    if (!sock) {
      return res
        .status(404)
        .json({ success: false, error: `Socket not found for ${instanceId}` });
    }

    const groups = await sock.groupFetchAllParticipating();
    const items = Object.values(groups).map((g) => ({
      jid: g.id,
      subject: g.subject,
      size: g.size ?? g.participants?.length ?? 0,
      owner: g.owner ?? null,
      creation: g.creation ?? null,
      desc: g.desc ?? null,
      announce: g.announce ?? false,
      restrict: g.restrict ?? false,
      isCommunity: (g as { isCommunity?: boolean }).isCommunity ?? false,
    }));

    logger.info("Groups list fetched", {
      event: "groups.list.success",
      tenantId,
      instanceId,
      count: items.length,
    });

    res.json({ success: true, instanceId, count: items.length, groups: items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.error("Groups list error", {
      event: "groups.list.error",
      error: message,
    });
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/wa/groups/inviteinfo
 * Body: { instanceId: "wa-01", code: "ABCxyz123" } OU { instanceId, url: "https://chat.whatsapp.com/ABCxyz123" }
 * Resolve invite hash sem entrar no grupo. Substitui dependencia da Stevo isa pra inspecao.
 */
groupsRouter.post(
  "/inviteinfo",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res
          .status(400)
          .json({ success: false, error: "Tenant ID missing" });
      }

      const { instanceId, code, url } = req.body as {
        instanceId?: string;
        code?: string;
        url?: string;
      };

      if (!instanceId) {
        return res
          .status(400)
          .json({ success: false, error: "Field 'instanceId' is required" });
      }

      let inviteCode = code;
      if (!inviteCode && url) {
        const match = url.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/);
        inviteCode = match?.[1];
      }
      if (!inviteCode) {
        return res.status(400).json({
          success: false,
          error: "Provide 'code' or a 'url' containing the invite hash",
        });
      }

      const scopedId = scoped(tenantId, instanceId);

      if (getConnectionStatus(scopedId) !== "ONLINE") {
        return res.status(400).json({
          success: false,
          error: `Instance ${instanceId} is not connected`,
        });
      }

      const sock = getSocket(scopedId);
      if (!sock) {
        return res
          .status(404)
          .json({ success: false, error: `Socket not found for ${instanceId}` });
      }

      const info = await sock.groupGetInviteInfo(inviteCode);

      logger.info("Group invite info fetched", {
        event: "groups.inviteinfo.success",
        tenantId,
        instanceId,
        inviteCode,
        groupJid: info.id,
      });

      res.json({
        success: true,
        instanceId,
        invite: {
          code: inviteCode,
          jid: info.id,
          subject: info.subject,
          size: info.size ?? info.participants?.length ?? 0,
          owner: info.owner ?? null,
          creation: info.creation ?? null,
          desc: info.desc ?? null,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      logger.error("Group invite info error", {
        event: "groups.inviteinfo.error",
        error: message,
      });
      res.status(500).json({ success: false, error: message });
    }
  },
);
