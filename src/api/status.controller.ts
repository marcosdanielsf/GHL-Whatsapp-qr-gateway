import { Request, Response, Router } from "express";
import {
  getConnectionStatus,
  getConnectedNumber,
  listInstances,
} from "../core/baileys";
import { getSupabaseClient } from "../infra/supabaseClient";
import { logger } from "../utils/logger";

export const statusRouter = Router();

/**
 * GET /api/wa/status?locationId=XXXX
 * Retorna status das instâncias WA para injeção JS no GHL (CORS aberto)
 */
statusRouter.get("/status", async (req: Request, res: Response) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Cache-Control", "no-cache");

  const { locationId } = req.query as { locationId?: string };

  if (!locationId) {
    return res.json({
      connected: false,
      instances: {},
      error: "locationId required",
    });
  }

  try {
    const supabase = getSupabaseClient();

    // Buscar integração pela location
    const { data: integration } = await supabase
      .from("ghl_wa_integrations")
      .select("id, location_id, is_active, tenant_id")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .single();

    if (!integration) {
      return res.json({ connected: false, locationId, instances: {} });
    }

    // Buscar instâncias da integração (incluindo tenant_id)
    const { data: instanceRows } = await supabase
      .from("ghl_wa_instances")
      .select("name, phone_number, status, tenant_id")
      .eq("ghl_integration_id", integration.id);

    const instances: Record<string, { connected: boolean; phone?: string }> =
      {};
    let anyConnected = false;
    let primaryInstance = "";
    let primaryPhone = "";

    for (const row of instanceRows || []) {
      // Usar scopedId = tenantId-name (igual ao restante do código)
      // tenant_id vem de ghl_wa_instances (não de ghl_wa_integrations que pode ser null)
      const tenantId = row.tenant_id || integration.tenant_id;
      const scopedId = tenantId ? `${tenantId}-${row.name}` : row.name;
      const connStatus = getConnectionStatus(scopedId);
      const isOnline = connStatus === "ONLINE";
      const phone =
        getConnectedNumber(scopedId) || row.phone_number || undefined;

      instances[row.name] = { connected: isOnline, phone };

      if (isOnline && !anyConnected) {
        anyConnected = true;
        primaryInstance = row.name;
        primaryPhone = phone || "";
      }
    }

    // Fallback: listar instâncias do runtime se não achou no Supabase
    if (Object.keys(instances).length === 0) {
      const runtimeInstances = listInstances();
      for (const inst of runtimeInstances) {
        const isOnline = getConnectionStatus(inst.instanceId) === "ONLINE";
        const phone = getConnectedNumber(inst.instanceId) || undefined;
        instances[inst.instanceId] = { connected: isOnline, phone };
        if (isOnline && !anyConnected) {
          anyConnected = true;
          primaryInstance = inst.instanceId;
          primaryPhone = phone || "";
        }
      }
    }

    return res.json({
      connected: anyConnected,
      locationId,
      instance: primaryInstance,
      phone: primaryPhone,
      instances,
    });
  } catch (err: any) {
    logger.error("[Status API]", err?.message);
    return res.json({
      connected: false,
      locationId,
      instances: {},
      error: "internal",
    });
  }
});
