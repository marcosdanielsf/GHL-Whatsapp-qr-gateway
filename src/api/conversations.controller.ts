/**
 * conversations.controller — F10 chat UI helpers.
 *
 * Endpoint pra o frontend pausar a IA de uma conversa quando o operador
 * humano decide assumir manualmente (botão "Assumir") OU quando ele envia
 * uma resposta inline pelo chat do Nexus. Em ambos os casos o lookup é
 * feito pelo par (instance + contact_phone) — o frontend não precisa
 * conhecer agentId nem conversationId.
 */

import { Router, Response } from 'express';
import { triggerAutoTakeover, type TakeoverSource } from '../services/conversationTakeover.service';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

function scopeInstance(tenantId: string, instanceId: string): string {
  if (instanceId.startsWith(`${tenantId}-`)) return instanceId;
  return `${tenantId}-${instanceId}`;
}

conversationsRouter.post(
  '/takeover-by-contact',
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

    const { instanceId, contactPhone, source } = req.body as {
      instanceId?: string;
      contactPhone?: string;
      source?: TakeoverSource;
    };

    if (!instanceId || !contactPhone) {
      return res
        .status(400)
        .json({ error: 'Campos obrigatórios: instanceId, contactPhone' });
    }

    const scoped = scopeInstance(tenantId, instanceId);
    const finalSource: TakeoverSource =
      source === 'inline_send' ? 'inline_send' : 'manual_button';

    const result = await triggerAutoTakeover(
      scoped,
      contactPhone,
      finalSource,
      req.user?.id ?? null,
    );

    if (!result.triggered) {
      const status = result.reason === 'no_active_conversation' ? 404 : 400;
      return res
        .status(status)
        .json({ ok: false, reason: result.reason ?? 'unknown' });
    }

    logger.info('[conversations] takeover via UI', {
      tenantId,
      instanceId,
      contactPhone,
      source: finalSource,
      conversationId: result.conversationId,
      agentId: result.agentId,
    });

    return res.json({
      ok: true,
      conversationId: result.conversationId,
      agentId: result.agentId,
      source: finalSource,
    });
  },
);
