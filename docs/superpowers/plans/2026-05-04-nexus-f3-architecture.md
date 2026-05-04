# Nexus F3 — Disparo Inteligente — Architecture Decision

> **Roadmap ref:** nexus-paridade-stevo-roadmap-2026-05-03.md § F3
> **Task Supabase:** `7569c4e1-2bd5-49af-b0ca-3a6c1cfba5b1`
> **Data:** 2026-05-04 BRT
> **Arquiteto:** claude-sonnet-4-6 (Architect Agent MOTTIVME)
> **Status:** DRAFT — aguarda decisao Marcos nas 3 one-way doors

---

## TL;DR (3 decisoes-chave)

1. **BYO key** — cliente traz proprio API key OpenAI/Gemini/Claude. MOTTIVME nao vira revendedor de LLM. Margem limpa, zero risco de vazamento de conta, custo $0 pra MOTTIVME.
2. **Cache de variações por campanha** — engine gera 5 variações uma única vez no ato de criação (não por mensagem). Worker sorteia variações aleatoriamente na hora do disparo. Custo ~$0,003/campanha de 1000 msgs vs $15/campanha em call-por-msg.
3. **Fila por tenant no BullMQ** — 1 Queue nomeada `campaign:{tenantId}` por tenant. Previne 1 cliente travar os outros. Custo zero extra (BullMQ suporta N queues no mesmo Redis).

---

## Contexto

`campaigns.controller.ts` atual é um stub: insere diretamente em `ghl_wa_message_queue` sem tabela de campanha, sem variações, sem rate-limit por chip, sem agendamento. O worker `queue.ts` já existe (BullMQ + Redis) com concurrency=1 e delay 3-4s entre mensagens — base sólida pra F3.

F3 é a feature mais valiosa do produto: justifica o R$800/mês que o Stevo cobra. Precisa ser sólida em anti-ban, usável sem suporte técnico, e econômica o suficiente pra MOTTIVME não perder margem.

---

## Decisão 1 — BYO Key vs MOTTIVME repassa key com markup

### Contexto de custo

- gpt-4o-mini: ~$0,00015/1k tokens input + $0,0006/1k tokens output
- 1 variação: ~50 tok input + 200 tok output = ~$0,000135 por variação
- 5 variações: ~$0,00068 por lote
- Estratégia cache (gera 1x por campanha, 5 variações, 1000 msgs): custo total ~**$0,00068/campanha**
- Estratégia call-por-msg: 1000 msgs × $0,000135 = **$0,135/campanha** → 200x mais caro

| Opcao | Pros | Contras | Custo MOTTIVME/mes | Risco 2a ordem |
|-------|------|---------|-------------------|----------------|
| **BYO key (RECOMENDADO)** | Zero custo LLM pra MOTTIVME. Cliente controla gasto. Sem risco de vazamento de conta MOTTIVME. Mais simples de implementar (sem proxy). | Cliente precisa criar conta OpenAI/Gemini. Onboarding ligeiramente mais complexo. | R$0 | Baixo — pior caso: cliente esquece de pagar a OpenAI e campanha falha |
| MOTTIVME repassa + markup | UX mais simples (cliente nao precisa de conta). Receita adicional (~R$10-50/cliente/mes). | MOTTIVME vira responsável por fatura OpenAI de todos os clientes. 1 cliente que abusa = prejuizo. Rate limits compartilhados entre clientes. Implementar proxy + metering complexo. | Variavel (pode ser positivo com markup mas com risco alto) | Alto — 1 campanha mal configurada de 10k msgs = $13,50 que MOTTIVME paga |

**Decisao: BYO key.**

Justificativa: o markup potencial (~R$50/cliente/mes) nao compensa o risco operacional de ser fiador do uso de LLM de todos os clientes. Com 8 clientes ativos = R$400/mes vs risco de 1 campanha abusiva de 10k msgs = -R$70 direto. Margem do produto ja e boa (R$800/mes por cliente), nao precisa de squeeze em LLM.

Encriptacao da key: `provider_api_key` armazenado criptografado via `pgcrypto` `pgp_sym_encrypt` com `ENCRYPTION_SECRET` no env. **Nunca plaintext no Supabase.**

---

## Decisão 2 — Engine de Variação: LLM call por msg vs batch vs cache de variações

| Opcao | Pros | Contras | Custo/campanha 1000 msgs | Risco anti-ban |
|-------|------|---------|------------------------|----------------|
| Call por msg | Variação máxima (cada msg literalmente única) | $0,135/campanha. Latência alta na fila (cada job precisa esperar LLM antes de enviar). Depende de disponibilidade da API em tempo real. | ~$0,14 | Baixo — máxima entropia |
| **Cache de variações (RECOMENDADO)** | Custo irrisório ($0,001/campanha). Rápido — worker sorteia do cache, sem I/O externo. Funciona mesmo se OpenAI cair durante o disparo. | 5 variações reutilizadas — padrão teórico detectável se volume muito alto (>5k msgs/campanha). | ~$0,001 | Médio — 5 templates rotativos |
| Batch (gera 100 variações 1x) | Mais entropia que 5-variação | $0,027/campanha. Ainda precisa de I/O antes do disparo. | ~$0,027 | Baixo-médio |

**Decisao: cache de 5 variações geradas no momento de criação da campanha (preview step do wizard).**

Justificativa: o cliente PRECISA ver as variações antes de disparar (UX é um step do wizard). Então a geração já acontece na criação, não no worker — o cache existe por design. O worker só sorteia. Custo ~$0,001 por campanha de 1000 msgs = R$0,005 (zero impacto). Anti-ban: com delay 5-30s entre msgs + rotação entre 5 variantes estruturalmente diferentes, o padrão é suficientemente quebrado pra evitar detecção automática do Meta.

**Adicionalmente:** variações ficam editáveis pelo cliente no wizard antes de confirmar. Isso significa que as variações saem com aprovação humana — o melhor filtro anti-spam possivel.

---

## Decisão 3 — Rate-limit Strategy (anti-ban por chip)

Limites informais Baileys/WhatsApp (não documentados pelo Meta, baseados em observação da comunidade):

- Chip novo (< 7 dias): ~50-100 msgs/dia antes de risco de soft-ban
- Chip com 7-30 dias: ~150-200 msgs/dia
- Chip aquecido (> 30 dias com histórico orgânico): ~250-500 msgs/dia
- Rajada sem delay: ban em minutos independente do volume

| Opcao | Pros | Contras | Complexidade |
|-------|------|---------|--------------|
| **Token bucket por chip com warmup config (RECOMENDADO)** | Respeita limite por chip individualmente. Permite configurar chip "frio" vs "quente". Rejeita jobs se bucket vazio (não perde mensagem, reagenda). | Requer tabela `chip_rate_state` ou campo em `ghl_wa_instances`. | Media |
| Delay fixo entre msgs | Simples. Já funciona no queue.ts (3-4s). | Nao considera volume diário acumulado. Chip novo com 500 msgs = ban garantido mesmo com delay. | Baixa |
| Worker concurrency=1 global | Simples. | Serializa TODOS os tenants no mesmo chip imaginário. Não é por chip, é global. | Baixa (mas errada) |

**Decisao: token bucket por chip, configuravel na criação da campanha.**

Modelo:

```
Chip state (em ghl_wa_instances ou tabela de suporte):
  - daily_sent_count: int (reset às 00:00 BRT via cron)
  - daily_limit: int (default 200, editavel pelo cliente por chip)
  - warmup_phase: enum(cold, warming, hot) — cold=50/dia, warming=150/dia, hot=250/dia
  - last_reset_at: timestamp
```

Worker antes de enviar cada mensagem:
1. Verifica `daily_sent_count < daily_limit` para o chip
2. Se bucket cheio: reagenda job com delay de `(next_day_00h - now)` — mensagem não perdida
3. Se bucket ok: envia + incrementa `daily_sent_count`
4. Entre mensagens da mesma campanha: delay configurado pelo cliente (5-30s range)
5. Entre lotes (a cada 20 msgs): delay adicional 1-5min configurável

---

## Decisão 4 — Schema Design

### 4 tabelas + considerações de volume

**Volume estimado:** 5 clientes × 1000 msgs/campanha × 10 campanhas/mês = 50.000 rows/mês em `campaign_messages`. Em 6 meses: 300.000 rows. Não é volume crítico ainda — partitioning por mês é DESNECESSÁRIO agora (overhead de manutenção não compensa antes de 5M+ rows). Revisar em 12 meses.

**Estratégia:** índices bem definidos em `campaign_id + status` são suficientes pra 300k rows. Partitioning fica como nota de rodapé pro roadmap v2.

---

```sql
-- ════════════════════════════════════════════════════
-- TABELA 1: campaigns
-- Cada campanha pertence a 1 tenant, usa 1 chip, tem N recipients.
-- ════════════════════════════════════════════════════
CREATE TABLE public.campaigns (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.ghl_wa_tenants(id) ON DELETE CASCADE,
    instance_id     text NOT NULL,       -- chip usado (foreign key lógica — não FK pra evitar cascade issues com sessions)
    name            text NOT NULL,
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','scheduled','running','paused','completed','failed','cancelled')),

    -- Template e variações
    base_message    text NOT NULL,       -- mensagem original digitada pelo cliente
    provider        text NOT NULL DEFAULT 'openai'
                    CHECK (provider IN ('openai','gemini','claude')),
    -- Nota: provider_api_key NUNCA armazenado aqui — vai em tenant_ai_keys (Decisão 1)

    -- Configuração de disparo
    send_immediately boolean NOT NULL DEFAULT true,
    scheduled_at    timestamptz,         -- NULL se send_immediately=true
    delay_min_seconds int NOT NULL DEFAULT 10 CHECK (delay_min_seconds >= 5),
    delay_max_seconds int NOT NULL DEFAULT 20 CHECK (delay_max_seconds <= 30),
    batch_size      int NOT NULL DEFAULT 20,  -- mensagens antes de pausa longa
    batch_delay_min_seconds int NOT NULL DEFAULT 60,   -- 1 min
    batch_delay_max_seconds int NOT NULL DEFAULT 300,  -- 5 min

    -- Origem da audience
    audience_source text NOT NULL DEFAULT 'csv'
                    CHECK (audience_source IN ('csv','ghl_tag','ghl_segment','manual')),
    ghl_filter      jsonb,               -- ex: {"tag": "lead-frio"} ou {"segment_id": "abc"}

    -- Contadores (denormalizados pra dashboard rápido)
    total_recipients int NOT NULL DEFAULT 0,
    sent_count      int NOT NULL DEFAULT 0,
    failed_count    int NOT NULL DEFAULT 0,
    replied_count   int NOT NULL DEFAULT 0,

    -- Metadados
    created_by      uuid NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    completed_at    timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT delay_range_valid CHECK (delay_min_seconds <= delay_max_seconds),
    CONSTRAINT batch_delay_valid CHECK (batch_delay_min_seconds <= batch_delay_max_seconds)
);

-- Índices campaigns
CREATE INDEX idx_campaigns_tenant_id ON public.campaigns(tenant_id);
CREATE INDEX idx_campaigns_tenant_status ON public.campaigns(tenant_id, status);
CREATE INDEX idx_campaigns_scheduled ON public.campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL AND status = 'scheduled';

-- RLS campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_campaigns"
    ON public.campaigns
    FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ════════════════════════════════════════════════════
-- TABELA 2: campaign_variants
-- 5 variações IA por campanha — geradas 1x na criação.
-- Worker sorteia aleatoriamente; cliente pode editar antes de disparar.
-- ════════════════════════════════════════════════════
CREATE TABLE public.campaign_variants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    tenant_id       uuid NOT NULL,       -- denormalizado pra RLS direta sem JOIN
    variant_index   smallint NOT NULL CHECK (variant_index BETWEEN 1 AND 10),
    content         text NOT NULL,       -- texto da variação (editável pelo cliente)
    approved        boolean NOT NULL DEFAULT true,  -- cliente pode desativar uma variação
    generated_by    text NOT NULL DEFAULT 'ai'
                    CHECK (generated_by IN ('ai','manual')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (campaign_id, variant_index)
);

-- Índices campaign_variants
CREATE INDEX idx_campaign_variants_campaign_id ON public.campaign_variants(campaign_id);
CREATE INDEX idx_campaign_variants_approved ON public.campaign_variants(campaign_id, approved) WHERE approved = true;

-- RLS campaign_variants
ALTER TABLE public.campaign_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_variants"
    ON public.campaign_variants
    FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ════════════════════════════════════════════════════
-- TABELA 3: campaign_recipients
-- Lista de destinatários (1 row por contato por campanha).
-- Pode ter 1M+ rows com 5 clientes ativos por 12 meses — precisa de índice forte.
-- ════════════════════════════════════════════════════
CREATE TABLE public.campaign_recipients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    tenant_id       uuid NOT NULL,
    phone           text NOT NULL,       -- E.164 normalizado (+5511999998888) via libphonenumber
    name            text,                -- nome pra personalização futura
    ghl_contact_id  text,               -- ID do contato no GHL (se origem = ghl_*)
    extra_data      jsonb,               -- campos extras do CSV ou GHL (pra merge tags futura)
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','failed','replied','skipped','opted_out')),
    variant_id      uuid REFERENCES public.campaign_variants(id),  -- qual variação foi usada
    bullmq_job_id   text,               -- ID do job BullMQ pra cancelamento
    sent_at         timestamptz,
    failed_at       timestamptz,
    fail_reason     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (campaign_id, phone)          -- evita duplicata na mesma campanha
);

-- Índices campaign_recipients (volume alto — índices são críticos)
CREATE INDEX idx_campaign_recipients_campaign_id ON public.campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_campaign_status ON public.campaign_recipients(campaign_id, status);
CREATE INDEX idx_campaign_recipients_tenant_id ON public.campaign_recipients(tenant_id);
CREATE INDEX idx_campaign_recipients_queued ON public.campaign_recipients(campaign_id) WHERE status = 'queued';
-- Sem índice em phone isolado: busca sempre é campaign_id + phone (UNIQUE cobre)

-- RLS campaign_recipients
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_recipients"
    ON public.campaign_recipients
    FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ════════════════════════════════════════════════════
-- TABELA 4: tenant_ai_keys
-- API keys LLM do cliente — BYO key, criptografadas em repouso.
-- 1 row por provider por tenant.
-- ════════════════════════════════════════════════════
CREATE TABLE public.tenant_ai_keys (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.ghl_wa_tenants(id) ON DELETE CASCADE,
    provider        text NOT NULL
                    CHECK (provider IN ('openai','gemini','claude','groq')),
    -- api_key_encrypted: usa pgp_sym_encrypt com ENCRYPTION_SECRET do backend
    -- NUNCA armazenar plaintext — backend descriptografa em memória apenas quando necessário
    api_key_encrypted text NOT NULL,
    label           text,                -- ex: "Minha conta OpenAI" (pra UI)
    is_active       boolean NOT NULL DEFAULT true,
    last_used_at    timestamptz,
    last_error      text,                -- último erro de autenticação (ex: "Invalid API key")
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, provider)         -- 1 key ativa por provider por tenant
);

-- Índices tenant_ai_keys
CREATE INDEX idx_tenant_ai_keys_tenant_id ON public.tenant_ai_keys(tenant_id);

-- RLS tenant_ai_keys
ALTER TABLE public.tenant_ai_keys ENABLE ROW LEVEL SECURITY;

-- Cliente so ve suas proprias keys — e nunca ve o campo api_key_encrypted via REST
-- (backend acessa via service_role, cliente acessa via RPC que nao expoe o valor)
CREATE POLICY "tenant_isolation_ai_keys"
    ON public.tenant_ai_keys
    FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ════════════════════════════════════════════════════
-- SUPORTE: chip rate state (adicionado em ghl_wa_instances)
-- Alternativa a tabela separada — menor overhead
-- ════════════════════════════════════════════════════
-- ALTER TABLE public.ghl_wa_instances
--     ADD COLUMN IF NOT EXISTS daily_sent_count int NOT NULL DEFAULT 0,
--     ADD COLUMN IF NOT EXISTS daily_limit int NOT NULL DEFAULT 200,
--     ADD COLUMN IF NOT EXISTS warmup_phase text NOT NULL DEFAULT 'hot'
--         CHECK (warmup_phase IN ('cold','warming','hot')),
--     ADD COLUMN IF NOT EXISTS rate_last_reset_at timestamptz DEFAULT now();
--
-- CRON reset diário (pg_cron ou função chamada pelo worker):
-- UPDATE ghl_wa_instances SET daily_sent_count = 0, rate_last_reset_at = now()
--     WHERE rate_last_reset_at < now() - interval '24 hours';
```

---

## Decisão 5 — Queue Model: 1 fila global vs 1 fila por tenant

| Opcao | Pros | Contras | Complexidade |
|-------|------|---------|--------------|
| 1 fila global (`campaign-messages`) | Simples. Já existe padrão em queue.ts. | 1 cliente com campanha de 5k msgs trava todos os outros. Sem fairness. Sem pause/resume granular por tenant. | Baixa |
| **1 fila por tenant (RECOMENDADO)** | Fairness total. Pause/resume de 1 campanha não afeta outros. Monitoramento granular por tenant. BullMQ suporta N queues no mesmo Redis (sem custo extra). | Worker precisa descobrir quais filas existem (padrão `campaign:{tenantId}`). Mais workers ou worker com round-robin entre filas. | Media |
| 1 fila por campanha | Granularidade máxima | Proliferação de filas (5 clientes × 10 campanhas = 50 filas ativas). Overhead de gestão. | Alta |

**Decisao: 1 fila por tenant, nomenclatura `campaign:{tenantId}`.**

Worker model: 1 CampaignWorker com round-robin entre filas ativas. A cada tick, worker verifica filas com jobs pendentes e pega 1 job de cada (round-robin), respeitando rate-limit por chip. Isso garante que cliente A com 5k msgs não bloqueia cliente B com 10 msgs.

**Implementação do round-robin:** lista de filas ativas mantida no Redis (`campaign:active-queues` como Set). Quando campanha é criada, tenantId é adicionado ao Set. Quando fila esvazia, tenantId é removido.

---

## Decisão 6 — Frontend Wizard (5 steps)

```
Step 1: Audience
├── Tab "Upload CSV"
│   ├── Drag-and-drop CSV
│   ├── Preview tabela (nome, telefone, campos extras)
│   └── Validação libphonenumber em tempo real (destaca números inválidos)
└── Tab "Sync GHL"
    ├── Dropdown: "Por tag" ou "Por segmento"
    ├── Search de tags existentes (call GET /api/campaigns/ghl/tags)
    └── Preview: "234 contatos encontrados" (call com debounce)

Step 2: Template
├── Textarea "Mensagem base" (max 1000 chars, contador vivo)
├── Chips de provider: OpenAI / Gemini / Claude
├── Status do provider key: badge verde "Key configurada" ou laranja "Configure sua key"
└── Link para Settings > AI Keys (nova sub-seção)

Step 3: Variations (geração IA ao entrar neste step)
├── Loading state: "Gerando variações com OpenAI..."
├── 5 cards editáveis (textarea por card)
├── Badge "IA" ou "Manual" por variação
├── Botão "Regenerar" (chama endpoint novamente)
├── Toggle ativo/inativo por variação (mínimo 2 ativas)
└── Botão "Continuar" só habilita com >= 2 variações ativas

Step 4: Schedule
├── Radio: "Disparar agora" ou "Agendar"
├── Se agendar: DatePicker + TimePicker (BRT)
├── Chip selector: dropdown dos chips do tenant (status badge ONLINE/OFFLINE)
├── Delay slider: "Entre mensagens: [5s]──────────────[30s]"
├── Delay lotes: "Entre lotes de 20: [1min]────────[5min]"
└── Resumo: "Estimativa: ~234 mensagens em ~38 minutos"

Step 5: Review
├── Card resumo: nome da campanha, chip, N contatos, agendamento
├── Preview de 1 variação aleatória (exemplo de como vai aparecer)
├── Aviso rate-limit: "Este chip está em fase 'aquecimento' — limite 150 msgs/dia"
├── Checkbox "Confirmo que tenho permissão para enviar para estes contatos"
└── Botão "Disparar Campanha" (chama POST /api/campaigns/launch)
```

**Status real-time após disparo:**
- Polling a cada 5s em `GET /api/campaigns/:id/status` (retorna contadores + status)
- Barra de progresso: `sent / total_recipients`
- Tabela paginada de recipients com status por linha
- Botões Pause / Resume / Cancelar (desativados se status != running)

---

## Diagrama de Arquitetura (text-based)

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENTE (browser — Vite SPA)                                       │
│                                                                     │
│  [Wizard 5 steps]                                                   │
│       │                                                             │
│       │ Step 3: POST /api/campaigns/generate-variants               │
│       │ ← {variants: [5 textos aprovados]}                         │
│       │                                                             │
│       │ Step 5: POST /api/campaigns/launch                          │
│       └─────────────────────────────────────────────────────────────┤
│                                                                     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ HTTPS + JWT
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND Express (src/api/campaigns.controller.ts — REFATORADO)     │
│                                                                     │
│  POST /generate-variants                                            │
│  ├── Busca tenant_ai_keys (service_role, decripta em memória)       │
│  ├── Chama OpenAI/Gemini/Claude com prompt anti-ban                 │
│  ├── Retorna 5 variações pra preview no wizard                      │
│  └── NÃO salva ainda (cliente ainda pode editar)                    │
│                                                                     │
│  POST /launch                                                       │
│  ├── Valida payload (Zod schema)                                    │
│  ├── INSERT campaigns + campaign_variants + campaign_recipients     │
│  ├── Para cada recipient:                                           │
│  │   └── messageQueue.add('campaign:{tenantId}', job, {delay})     │
│  └── Retorna {campaignId, estimatedMinutes}                         │
│                                                                     │
│  GET /:id/status                                                    │
│  └── SELECT sent_count, failed_count, status FROM campaigns         │
│                                                                     │
│  POST /:id/pause | /resume | /cancel                               │
│  ├── UPDATE campaigns SET status = ...                              │
│  └── BullMQ: queue.pause() | queue.resume() | queue.drain()        │
│                                                                     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ BullMQ add job
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  REDIS (Coolify — mesmo VPS)                                        │
│                                                                     │
│  Filas:                                                             │
│  ├── "campaign:{tenantId-A}"  ← jobs campanha cliente A            │
│  ├── "campaign:{tenantId-B}"  ← jobs campanha cliente B            │
│  └── "campaign:active-queues" ← Set com tenants com fila ativa     │
│                                                                     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ Worker poll (round-robin)
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CAMPAIGN WORKER (src/core/campaignWorker.ts — NOVO)                │
│                                                                     │
│  Loop tick (a cada 500ms):                                          │
│  ├── Busca lista de tenants ativos em "campaign:active-queues"      │
│  ├── Para cada tenant (round-robin):                                │
│  │   ├── Verifica rate-limit: daily_sent_count < daily_limit?       │
│  │   │   └── Se bucket cheio: delay job pra meia-noite BRT         │
│  │   ├── Verifica status da campanha: paused? → pula               │
│  │   ├── Sorteia variant_index aleatório dentre variações aprovadas │
│  │   ├── Calcula delay humanizado: rand(delay_min, delay_max) s     │
│  │   ├── Checa se é início de novo lote → aplica batch_delay       │
│  │   └── Chama sendTextMessage(instanceId, phone, variantContent)   │
│  │                                                                   │
│  │  On success:                                                     │
│  │   ├── UPDATE campaign_recipients SET status='sent', sent_at=now()│
│  │   ├── UPDATE campaigns SET sent_count = sent_count + 1          │
│  │   └── UPDATE ghl_wa_instances SET daily_sent_count += 1         │
│  │                                                                   │
│  │  On failure:                                                     │
│  │   ├── UPDATE campaign_recipients SET status='failed', reason=... │
│  │   └── UPDATE campaigns SET failed_count += 1                    │
│  │                                                                   │
│  │  On campaign complete (sent+failed = total):                     │
│  │   ├── UPDATE campaigns SET status='completed', completed_at=now()│
│  │   └── REMOVE tenantId from "campaign:active-queues"             │
│  │                                                                   │
│  └── Aguarda delay antes do próximo job deste tenant                │
│                                                                     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ Baileys sendTextMessage()
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BAILEYS (src/core/baileys.ts — EXISTENTE)                          │
│                                                                     │
│  ├── getConnectionStatus(instanceId) → ONLINE/OFFLINE/CONNECTING   │
│  ├── sendTextMessage(instanceId, to, content)                       │
│  └── WhatsApp socket → Meta servidores                              │
│                                                                     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ Logs de envio
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SUPABASE                                                           │
│                                                                     │
│  campaigns            ← status + contadores                        │
│  campaign_variants    ← 5 variações por campanha                   │
│  campaign_recipients  ← status por destinatário + variant usado    │
│  tenant_ai_keys       ← keys BYO criptografadas                    │
│  ghl_wa_instances     ← daily_sent_count + daily_limit             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prompt de variação IA (referência — vai para validação com marketing-copywriter)

```
Você é um especialista em copywriting para WhatsApp.

Reescreva a mensagem abaixo em 5 versões DIFERENTES mantendo o mesmo significado e tom.
Cada versão deve ter estrutura de frase diferente (não apenas trocar sinônimos).
Varie: comprimento, pontuação, emojis (use em 3 versões, omita em 2), ordem das ideias.
Escreva em português brasileiro natural. Não use linguagem corporativa.
Não inclua saudação — ela será personalizada separadamente.

Mensagem original:
{base_message}

Responda SOMENTE um JSON array com 5 strings. Sem explicações.
```

---

## Novos endpoints necessários

| Endpoint | Auth | Descrição |
|----------|------|-----------|
| `POST /api/campaigns/generate-variants` | requireAuth | Chama LLM, retorna 5 variações. Não salva. |
| `POST /api/campaigns/launch` | requireAuth | Salva campanha + enfileira jobs. |
| `GET /api/campaigns` | requireAuth | Lista campanhas do tenant com contadores. |
| `GET /api/campaigns/:id` | requireAuth | Detalhe + recipients paginados. |
| `GET /api/campaigns/:id/status` | requireAuth | Polling de progresso (sent/failed/total). |
| `POST /api/campaigns/:id/pause` | requireAuth | Pausa fila do tenant. |
| `POST /api/campaigns/:id/resume` | requireAuth | Retoma fila do tenant. |
| `POST /api/campaigns/:id/cancel` | requireAuth | Drena fila + marca cancelled. |
| `POST /api/campaigns/ghl/sync` | requireAuth | Puxa contatos GHL por tag/segmento. |
| `POST /api/campaigns/csv/parse` | requireAuth | Faz parse + validação de CSV (retorna preview). |
| `GET /api/campaigns/ghl/tags` | requireAuth | Lista tags disponíveis no GHL do tenant. |
| `POST /api/settings/ai-keys` | requireAuth | Salva/atualiza BYO key (encripta antes de salvar). |
| `DELETE /api/settings/ai-keys/:provider` | requireAuth | Remove key. |
| `GET /api/settings/ai-keys` | requireAuth | Lista providers configurados (sem expor key). |

---

## Riscos Não-Óbvios

### Risco 1 — Ban por padrão de horário, não por volume
Todos os clientes que usam o nexus com o mesmo delay padrão (5-20s) criarão um padrão estatístico similar que o sistema anti-spam do Meta pode correlacionar se os IPs dos chips forem próximos (mesmo VPS). 

**Mitigacao:** adicionar jitter real (delay não linear — use distribuição normal, não uniforme). Implementar no worker: `delay = normalRandom(mean=15, stddev=4)` em vez de `rand(5, 30)`. Custo de implementação: 1h.

### Risco 2 — Chip desconecta mid-campaign
Chip conectado via Baileys pode cair durante uma campanha de 1000 msgs. Worker vai falhar em job, tentará retry com backoff — mas se chip demorar horas pra reconectar, campanha fica travada sem feedback visual.

**Mitigacao:** ao detectar `OFFLINE` no chip, pausar automaticamente a campanha (`status='paused'`, `pause_reason='chip_offline'`) e notificar via webhook ou SSE. Cliente vê no dashboard e pode reconectar o chip manualmente. Implementar como listener no evento `connection.update` do Baileys já existente.

### Risco 3 — CSV com números inválidos gera falhas silenciosas
Se cliente sobe CSV com 200 números sem código de país, libphonenumber vai tentar assumir BR por default — pode funcionar pra maioria mas falhar em 10-20% com mensagem de erro genérica do Baileys.

**Mitigacao:** no step de CSV preview, mostrar com destaque os números que precisam de correção. Bloquear avanço do wizard se > 5% dos números forem inválidos. Sugerir "Adicionar +55 a todos?" como ação em lote.

### Risco 4 — Race condition entre pause e jobs já em voo
Worker com round-robin pode ter 2-3 jobs em processamento simultâneo quando cliente clica pause. Esses jobs continuam sendo enviados — pode enviar 2-3 msgs após o cliente ter clicado pause.

**Mitigacao:** pause é "soft" por design (documentar isso na UI: "O envio em progresso será concluído antes de pausar"). BullMQ `queue.pause()` garante que novos jobs não iniciam. Jobs já em `active` state terminam naturalmente. Comportamento aceitável e esperado.

### Risco 5 — GHL API rate limit ao sincronizar audiência grande
GHL limita a ~100 requests/min por location. Um segmento com 2000 contatos = 20+ páginas de 100 = risco de 429.

**Mitigacao:** paginação com delay de 600ms entre requests no sync GHL. Mostrar progress bar "Importando contatos do GHL: 340/2000". Se 429, retry com backoff 5s + log para o cliente. Implementar como job BullMQ separado (`ghl-sync-job`) com status SSE — não bloquear o wizard.

---

## Dependências de F1 que F3 precisa

F3 assume que F1 já está completa (auth Supabase, RLS em ghl_wa_instances). Pontos críticos:

1. `get_auth_tenant_id()` RPC deve existir e funcionar (confirmado no plano F1)
2. `ghl_wa_instances` deve ter `tenant_id` e RLS ativa (confirmado no F1 audit)
3. `ghl_wa_tenants` deve ter `ghl_location_id` + `ghl_access_token` (necessário pra sync GHL)
4. CampaignsView stub no frontend (mencionada no F1 audit como view existente) deve ser expandida — não reescrita

---

## Fases de Implementacao

| Fase | Escopo | Agente | Dependencia |
|------|--------|--------|-------------|
| F3-A | Schema SQL + migrations das 4 tabelas + ALTER em ghl_wa_instances | `supabase-dba` | Nenhuma |
| F3-B | Backend: endpoints generate-variants + settings/ai-keys + CSV parser | `nextjs-fullstack` (backend Express) | F3-A |
| F3-C | CampaignWorker: round-robin + token bucket + variant sorter | `nextjs-fullstack` (backend Express) | F3-A, F3-B |
| F3-D | Backend: launch + pause + resume + cancel + status polling | `nextjs-fullstack` (backend Express) | F3-A, F3-C |
| F3-E | Backend: GHL sync endpoint | `nextjs-fullstack` (backend Express) | F3-B |
| F3-F | Frontend: wizard 5 steps + status dashboard + AI Keys settings | `nextjs-fullstack` (frontend Vite) | F3-B, F3-D |
| F3-G | Code review E2E + QA manual campanha teste 50 msgs | `code-reviewer` + Marcos QA | F3-F |

Estimativa total: 18-24h de implementação distribuídas em 2-3 sessões Claude Code.

---

## Decisoes que Marcos Precisa Confirmar

Todas são one-way doors ou envolvem custo/risco:

1. **BYO key vs MOTTIVME repassa** — recomendo BYO. Se Marcos quiser explorar markup, precisará de contrato de revenda OpenAI e sistema de metering — adiciona +8h de implementação e risco financeiro.

2. **Daily limit default por chip** — recomendo 200 msgs/dia como default com warmup automático (cold=50, warming=150, hot=250). Marcos pode querer permitir que o cliente configure manualmente acima de 250 pra chips muito aquecidos. Decisão de produto (UX de risco vs controle).

3. **Pause behavior** — confirmado como "soft pause" (jobs em voo terminam). Se Marcos quiser "hard pause" (cancela job imediatamente), requer implementação diferente com interrupção de worker — +3h de complexidade.

---

*Documento gerado em 2026-05-04 BRT | Arquiteto: claude-sonnet-4-6 | Versão 1.0*
