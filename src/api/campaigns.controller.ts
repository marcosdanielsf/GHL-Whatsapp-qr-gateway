import { Router, Response, Request } from 'express';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { getSupabaseClient } from '../infra/supabaseClient';
import { generateVariants } from '../core/openai-variants';
import { getDecryptedKey } from '../core/decrypt-ai-key';
import { enqueueCampaign, startCampaignWorkers } from '../core/campaign-worker';
import { logger } from '../utils/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

// ─────────────────────────────────────────────
// POST /api/campaigns/generate-variants
// Preview wizard: gera 5 variações anti-ban sem salvar
// ─────────────────────────────────────────────

campaignsRouter.post('/generate-variants', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const { template } = req.body;
  if (!template || typeof template !== 'string') {
    return res.status(400).json({ error: 'template é obrigatório' });
  }

  const supabase = getSupabaseClient();
  const keyRecord = await getDecryptedKey(supabase, tenantId);
  if (!keyRecord) {
    return res.status(422).json({
      error: 'Nenhuma API key OpenAI configurada. Configure em /api/settings/ai-keys.',
    });
  }

  try {
    const result = await generateVariants(keyRecord.api_key, template, keyRecord.model);
    return res.json(result);
  } catch (err: any) {
    logger.error('[CAMPAIGNS] generate-variants falhou', {
      event: 'campaigns.generate_variants.error',
      tenantId,
      error: err.message,
    });
    return res.status(502).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/campaigns
// Cria campanha + 5 variants + N recipients
// ─────────────────────────────────────────────

campaignsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const {
    name,
    instance_id,
    template_original,
    variants,
    recipients,
    delay_min_ms = 3000,
    delay_max_ms = 6000,
    batch_size = 20,
    scheduled_for,
  } = req.body;

  if (!name || !instance_id || !template_original) {
    return res.status(400).json({ error: 'name, instance_id e template_original são obrigatórios' });
  }

  if (!Array.isArray(variants) || variants.length !== 5) {
    return res.status(400).json({ error: 'variants deve ter exatamente 5 itens' });
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'recipients é obrigatório e não pode ser vazio' });
  }

  // Validar e normalizar phones
  const valid: Array<{ phone: string; name?: string; variables?: Record<string, string> }> = [];
  const invalid: string[] = [];

  for (const r of recipients) {
    const raw: string = r.phone ?? r;
    const parsed = parsePhoneNumberFromString(raw, 'BR');
    if (parsed && parsed.isValid()) {
      valid.push({
        phone: parsed.format('E.164'),
        name: r.name,
        variables: r.variables,
      });
    } else {
      invalid.push(raw);
    }
  }

  if (valid.length === 0) {
    return res.status(400).json({ error: 'Nenhum número válido em recipients', invalid });
  }

  const supabase = getSupabaseClient();

  // INSERT campaign
  const campaignStatus = scheduled_for ? 'scheduled' : 'draft';
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .insert({
      tenant_id: tenantId,
      instance_id,
      name,
      template_original,
      status: campaignStatus,
      recipient_count: valid.length,
      sent_count: 0,
      failed_count: 0,
      replied_count: 0,
      delay_min_ms,
      delay_max_ms,
      batch_size,
      scheduled_for: scheduled_for ?? null,
    })
    .select('id')
    .single();

  if (campErr || !campaign) {
    logger.error('[CAMPAIGNS] Erro ao criar campanha', { error: campErr?.message, tenantId });
    return res.status(500).json({ error: 'Erro ao criar campanha' });
  }

  const campaignId = campaign.id as string;

  // INSERT 5 variants
  const variantRows = variants.map((text: string, i: number) => ({
    campaign_id: campaignId,
    tenant_id: tenantId,
    variant_index: i,
    text_template: text,
    ai_generated: true,
  }));

  const { error: varErr } = await supabase.from('campaign_variants').insert(variantRows);
  if (varErr) {
    logger.error('[CAMPAIGNS] Erro ao inserir variants', { error: varErr.message, campaignId });
    // Cleanup campaign
    await supabase.from('campaigns').delete().eq('id', campaignId);
    return res.status(500).json({ error: 'Erro ao salvar variações' });
  }

  // INSERT recipients em batches de 100 (Supabase REST limit)
  const recipientRows = valid.map((r) => ({
    campaign_id: campaignId,
    tenant_id: tenantId,
    phone_e164: r.phone,
    name: r.name ?? null,
    variables: r.variables ?? null,
    status: 'queued',
  }));

  const BATCH = 100;
  for (let i = 0; i < recipientRows.length; i += BATCH) {
    const { error: recErr } = await supabase
      .from('campaign_recipients')
      .insert(recipientRows.slice(i, i + BATCH));

    if (recErr) {
      logger.error('[CAMPAIGNS] Erro ao inserir recipients', {
        error: recErr.message,
        batchStart: i,
        campaignId,
      });
      await supabase.from('campaigns').delete().eq('id', campaignId);
      return res.status(500).json({ error: 'Erro ao salvar destinatários' });
    }
  }

  logger.info('[CAMPAIGNS] Campanha criada', {
    event: 'campaigns.created',
    campaignId,
    tenantId,
    recipient_count: valid.length,
    invalid_count: invalid.length,
    status: campaignStatus,
  });

  return res.status(201).json({
    campaign_id: campaignId,
    recipient_count: valid.length,
    valid: valid.length,
    invalid,
    status: campaignStatus,
  });
});

// ─────────────────────────────────────────────
// GET /api/campaigns
// ─────────────────────────────────────────────

campaignsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const status = (req.query.status as string) || 'all';
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const supabase = getSupabaseClient();

  let query = supabase
    .from('campaigns')
    .select(
      'id, name, status, recipient_count, sent_count, failed_count, replied_count, scheduled_for, started_at, completed_at, created_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('[CAMPAIGNS] Erro ao listar', { error: error.message, tenantId });
    return res.status(500).json({ error: 'Erro ao listar campanhas' });
  }

  return res.json({ campaigns: data ?? [] });
});

// ─────────────────────────────────────────────
// GET /api/campaigns/:id
// ─────────────────────────────────────────────

campaignsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (campErr || !campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada' });
  }

  const { data: variants } = await supabase
    .from('campaign_variants')
    .select('variant_index, text_template, ai_generated, token_cost')
    .eq('campaign_id', id)
    .eq('tenant_id', tenantId)
    .order('variant_index');

  return res.json({ campaign, variants: variants ?? [] });
});

// ─────────────────────────────────────────────
// POST /api/campaigns/:id/start
// ─────────────────────────────────────────────

campaignsRouter.post('/:id/start', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (campErr || !campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada' });
  }

  if (campaign.status === 'running') {
    return res.status(409).json({ error: 'Campanha já está em execução' });
  }

  if (!['draft', 'scheduled', 'paused'].includes(campaign.status)) {
    return res.status(409).json({ error: `Não é possível iniciar campanha com status '${campaign.status}'` });
  }

  const { error: updateErr } = await supabase
    .from('campaigns')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (updateErr) {
    return res.status(500).json({ error: 'Erro ao atualizar status da campanha' });
  }

  const queued = await enqueueCampaign(id, tenantId);

  logger.info('[CAMPAIGNS] Campanha iniciada', {
    event: 'campaigns.started',
    campaignId: id,
    tenantId,
    queued,
  });

  return res.json({ ok: true, queued });
});

// ─────────────────────────────────────────────
// POST /api/campaigns/:id/pause
// ─────────────────────────────────────────────

campaignsRouter.post('/:id/pause', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });
  if (campaign.status !== 'running') {
    return res.status(409).json({ error: `Campanha não está running (status: ${campaign.status})` });
  }

  await supabase
    .from('campaigns')
    .update({ status: 'paused' })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  // Worker detecta status='paused' no próximo job e re-enfileira com delay
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────
// POST /api/campaigns/:id/resume
// ─────────────────────────────────────────────

campaignsRouter.post('/:id/resume', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });
  if (campaign.status !== 'paused') {
    return res.status(409).json({ error: `Campanha não está pausada (status: ${campaign.status})` });
  }

  await supabase
    .from('campaigns')
    .update({ status: 'running' })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  // Re-enfileirar recipients que ficaram pendentes durante o pause
  const queued = await enqueueCampaign(id, tenantId);

  return res.json({ ok: true, re_queued: queued });
});

// ─────────────────────────────────────────────
// DELETE /api/campaigns/:id
// Só permite se status = draft ou cancelled
// ─────────────────────────────────────────────

campaignsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });

  if (!['draft', 'cancelled'].includes(campaign.status)) {
    return res.status(409).json({
      error: `Não é possível deletar campanha com status '${campaign.status}'. Cancele primeiro.`,
    });
  }

  await supabase.from('campaign_recipients').delete().eq('campaign_id', id);
  await supabase.from('campaign_variants').delete().eq('campaign_id', id);
  await supabase.from('campaigns').delete().eq('id', id).eq('tenant_id', tenantId);

  logger.info('[CAMPAIGNS] Campanha deletada', {
    event: 'campaigns.deleted',
    campaignId: id,
    tenantId,
  });

  return res.json({ ok: true });
});

// ─────────────────────────────────────────────
// GET /api/campaigns/:id/recipients
// ─────────────────────────────────────────────

campaignsRouter.get('/:id/recipients', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const status = req.query.status as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const supabase = getSupabaseClient();

  // Verificar ownership
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });

  let query = supabase
    .from('campaign_recipients')
    .select('id, phone_e164, name, status, sent_at, error_message, retry_count, variant_index', { count: 'exact' })
    .eq('campaign_id', id)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) {
    return res.status(500).json({ error: 'Erro ao buscar destinatários' });
  }

  return res.json({ recipients: data ?? [], total: count ?? 0, limit, offset });
});

// ─────────────────────────────────────────────
// GET /api/campaigns/:id/stream — SSE
// Envia snapshot de counts a cada 2s, fecha quando done/cancelled
// ─────────────────────────────────────────────

campaignsRouter.get('/:id/stream', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(400).json({ error: 'Tenant ID ausente' });
    return;
  }
  const { id } = req.params;

  const supabase = getSupabaseClient();

  // Verificar ownership
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, tenant_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!campaign) {
    res.status(404).json({ error: 'Campanha não encontrada' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;

  const interval = setInterval(async () => {
    if (closed) return;

    const { data } = await supabase
      .from('campaigns')
      .select('status, sent_count, failed_count, replied_count, recipient_count')
      .eq('id', id)
      .single();

    if (!data) {
      clearInterval(interval);
      res.end();
      return;
    }

    const queued = (data.recipient_count ?? 0) - (data.sent_count ?? 0) - (data.failed_count ?? 0);

    send({
      sent: data.sent_count ?? 0,
      queued: Math.max(0, queued),
      failed: data.failed_count ?? 0,
      replied: data.replied_count ?? 0,
      status: data.status,
    });

    if (['done', 'cancelled'].includes(data.status)) {
      clearInterval(interval);
      res.end();
    }
  }, 2000);

  req.on('close', () => {
    closed = true;
    clearInterval(interval);
  });
});
