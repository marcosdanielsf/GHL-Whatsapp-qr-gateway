# Nexus F1 — Frontend SPA Dashboard Cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar gaps F1 do roadmap nexus paridade Stevo — corrigir bug de inbox unreachable, RLS multi-tenant em `ghl_wa_message_history`, remover Demo User, adicionar magic link, webhook events selecionáveis. Frontend SPA cliente já existe; isto é audit + correções cirúrgicas.

**Architecture:** Vite SPA (React 19 + Tailwind 4 + Radix + Supabase Auth) já implantada em `/frontend/` com `AuthContext`, `Sidebar`, `AppContent` e components-views. Gaps são pontuais — adicionar 1 rota, 1 policy RLS, refatorar Login, ampliar SettingsView. Backend Express continua intacto.

**Tech Stack:** React 19 / Vite 7 / TypeScript / Tailwind 4 / Supabase JS 2.88 / react-router-dom 7 / Radix UI / pnpm

**Repo:** `/Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway` (branch `main` → criar `feat/nexus-f1-frontend-cliente`)

**Task Supabase pai:** `fe52f27f-f6e7-4119-b630-fa912e343a79`

**Memory base:** `/Users/marcosdaniels/.claude/projects/-Users-marcosdaniels/memory/nexus-paridade-stevo-roadmap-2026-05-03.md` seção F1

**Estado descoberto na auditoria (2026-05-03 BRT):**
- Auth Supabase email/senha funciona (`AuthContext.signUp/signIn`, RPC `create_tenant_with_user` ja existe)
- Sidebar/AppContent tem views: control, instances, webhooks, settings, billing, campaigns
- `MessageHistoryView` componente existe em `frontend/src/components/MessageHistory.tsx` com tabs+search+polling — **MAS não está roteado** (bug)
- RLS existe em `ghl_wa_instances`/`ghl_wa_tenants`/`ghl_wa_users` via `get_auth_tenant_id()` mas **`ghl_wa_message_history` está desprotegida**
- Login.tsx tem botão "Demo User (Preview Mode)" que injeta `demo@example.com / demo123` — credenciais hardcoded
- SettingsView salva `webhook_url` + `webhook_secret` no `ghl_wa_tenants` mas não há seleção de eventos
- RPC `get_auth_tenant_id()` confirmada presente

---

### Task 1: Criar branch e validar baseline

**Files:**
- Modify: `package.json` (none — só validação)

- [ ] **Step 1: Validar repo + branch**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git remote -v && git status -sb
```

Expected: origin = `marcosdanielsf/GHL-Whatsapp-qr-gateway`, branch `main` clean (modified files atuais são `.bkp` antigos não relacionados).

- [ ] **Step 2: Criar branch F1**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git checkout -b feat/nexus-f1-frontend-cliente
```

Expected: `Switched to a new branch 'feat/nexus-f1-frontend-cliente'`

- [ ] **Step 3: Validar build frontend baseline**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend && pnpm install && pnpm build
```

Expected: build sem erros (snapshot pre-mudanças). Se quebrar aqui, corrigir antes de prosseguir.

---

### Task 2: RLS em `ghl_wa_message_history` (gap crítico de segurança)

**Files:**
- Create: `sql/2026-05-03-rls-message-history.sql`
- Apply: via `curl Mgmt API` (Constitution Art. VI)

- [ ] **Step 1: Confirmar tabela tem `tenant_id`**

```bash
curl -s -X POST 'https://api.supabase.com/v1/projects/bfumywvwubvernvhjehk/database/query' \
  -H 'Authorization: Bearer ${SUPABASE_MGMT_API_KEY}' \
  -H 'Content-Type: application/json' \
  -d '{"query":"SELECT column_name FROM information_schema.columns WHERE table_schema='\''public'\'' AND table_name='\''ghl_wa_message_history'\'' ORDER BY ordinal_position;"}'
```

Expected: lista deve incluir `tenant_id` (uuid). Se não incluir, **PARAR** e escalar pro Marcos — pode haver `instance_id` que joga via instance.

- [ ] **Step 2: Escrever migration SQL**

Criar `sql/2026-05-03-rls-message-history.sql`:

```sql
-- 2026-05-03 BRT — F1: RLS multi-tenant em ghl_wa_message_history
-- Roadmap: nexus-paridade-stevo-roadmap-2026-05-03.md F1
-- Rollback abaixo

ALTER TABLE public.ghl_wa_message_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant messages"
  ON public.ghl_wa_message_history
  FOR SELECT
  USING (tenant_id = public.get_auth_tenant_id());

-- Service role bypass (backend Express usa service_role key, não precisa policy)
-- INSERT/UPDATE/DELETE são feitos exclusivamente pelo backend → sem policies extra

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Users can view own tenant messages" ON public.ghl_wa_message_history;
-- ALTER TABLE public.ghl_wa_message_history DISABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Aplicar via Mgmt API**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && curl -s -X POST \
  'https://api.supabase.com/v1/projects/bfumywvwubvernvhjehk/database/query' \
  -H 'Authorization: Bearer ${SUPABASE_MGMT_API_KEY}' \
  -H 'Content-Type: application/json' \
  -d "$(jq -Rs '{query: .}' < sql/2026-05-03-rls-message-history.sql)"
```

Expected: `[]` (DDL sem retorno). Validar com:

```bash
curl -s -X POST 'https://api.supabase.com/v1/projects/bfumywvwubvernvhjehk/database/query' \
  -H 'Authorization: Bearer ${SUPABASE_MGMT_API_KEY}' \
  -H 'Content-Type: application/json' \
  -d '{"query":"SELECT policyname FROM pg_policies WHERE tablename='\''ghl_wa_message_history'\'';"}'
```

Expected: retorna `Users can view own tenant messages`.

- [ ] **Step 4: Commit**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git add sql/2026-05-03-rls-message-history.sql && git commit -m "feat(security): RLS multi-tenant em ghl_wa_message_history"
```

---

### Task 3: Adicionar rota "Messages" no Sidebar + AppContent

**Files:**
- Modify: `frontend/src/components/AppContent.tsx` (linhas 24-30 + render block)
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/i18n/` (adicionar key `messages` se não existe)

- [ ] **Step 1: Ler Sidebar.tsx atual**

```bash
cat /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend/src/components/Sidebar.tsx
```

Identificar formato dos items. Adicionar item "messages" seguindo padrão existente (control, instances, webhooks, settings, billing, campaigns).

- [ ] **Step 2: Atualizar tipo `View` em AppContent.tsx**

Em `frontend/src/components/AppContent.tsx` linha 24-30, trocar:

```tsx
type View =
  | "control"
  | "instances"
  | "webhooks"
  | "settings"
  | "billing"
  | "campaigns";
```

por:

```tsx
type View =
  | "control"
  | "instances"
  | "messages"
  | "webhooks"
  | "settings"
  | "billing"
  | "campaigns";
```

- [ ] **Step 3: Adicionar import e ramo de render**

Em `frontend/src/components/AppContent.tsx` topo (junto com outros imports):

```tsx
import { MessageHistoryView } from "./MessageHistory";
```

E no JSX render, após o ramo `view === "instances"` e antes de `view === "webhooks"`:

```tsx
{view === "messages" && (
  <div className="full-width-section">
    <MessageHistoryView />
  </div>
)}
```

- [ ] **Step 4: Adicionar item "messages" no Sidebar**

Em `frontend/src/components/Sidebar.tsx`, adicionar entrada (estrutura exata depende do que já existe — seguir padrão dos outros items, label `t('messages')`, ícone `Icons.Message` ou `Icons.History`).

- [ ] **Step 5: Adicionar tradução `messages`**

Em `frontend/src/i18n/` (procurar arquivos de locale, geralmente `en.ts`/`pt.ts`/`es.ts`), adicionar key `messages: "Messages"` / `"Mensagens"` / `"Mensajes"`.

- [ ] **Step 6: Validar build TS**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend && pnpm build
```

Expected: build limpo. Tipo `View` aceita `"messages"`, sem erros TS.

- [ ] **Step 7: Commit**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git add frontend/src/components/AppContent.tsx frontend/src/components/Sidebar.tsx frontend/src/i18n/ && git commit -m "fix(nexus-f1): rotear MessageHistoryView no AppContent + sidebar"
```

---

### Task 4: Remover Demo User hardcoded do Login

**Files:**
- Modify: `frontend/src/pages/Login.tsx` (linhas 73-92)

- [ ] **Step 1: Ler Login.tsx atual**

Verificado no audit: linhas 73-92 contêm divider "Or continue with" + button "Demo User (Preview Mode)" que faz `setEmail('demo@example.com'); setPassword('demo123')`. Isso vaza credenciais e implica modo preview que não existe em produção.

- [ ] **Step 2: Remover bloco demo**

Em `frontend/src/pages/Login.tsx`, deletar das linhas 73 a 92 (do `<div className="relative my-4">` até o `</Button>` do "Demo User").

Resultado esperado: form fica `Email → Password → Sign In Button` direto, sem divider nem botão demo.

- [ ] **Step 3: Validar build**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend && pnpm build
```

Expected: build limpo.

- [ ] **Step 4: Commit**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git add frontend/src/pages/Login.tsx && git commit -m "fix(security): remover Demo User hardcoded do Login"
```

---

### Task 5: Adicionar Magic Link option no Login

**Files:**
- Modify: `frontend/src/pages/Login.tsx`

- [ ] **Step 1: Adicionar handler magic link**

Em `frontend/src/pages/Login.tsx`, adicionar após `handleSubmit`:

```tsx
const [magicLinkSent, setMagicLinkSent] = useState(false);

const handleMagicLink = async () => {
    if (!email) {
        setError('Enter your email first');
        return;
    }
    setError('');
    setLoading(true);
    try {
        const { supabase } = await import('../lib/supabase');
        const { error: otpError } = await supabase.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: window.location.origin,
            },
        });
        if (otpError) throw otpError;
        setMagicLinkSent(true);
    } catch (err: any) {
        setError(err.message || 'Failed to send magic link');
    } finally {
        setLoading(false);
    }
};
```

- [ ] **Step 2: Adicionar botão Magic Link no JSX**

Após o button "Sign In" e antes do `<CardFooter>`, adicionar:

```tsx
{magicLinkSent ? (
    <div className="p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md">
        Magic link sent. Check your email.
    </div>
) : (
    <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleMagicLink}
        disabled={loading || !email}
    >
        Send Magic Link
    </Button>
)}
```

- [ ] **Step 3: Validar build**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend && pnpm build
```

Expected: build limpo.

- [ ] **Step 4: Teste manual local**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend && pnpm dev
```

Abrir http://localhost:5173/login, digitar email válido, clicar "Send Magic Link". Verificar inbox (Supabase Auth envia email default; se não chegar, é template config no dashboard Supabase — fora do escopo F1).

Expected (visual): mensagem verde "Magic link sent. Check your email." aparece. Inbox recebe email com link.

- [ ] **Step 5: Commit**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git add frontend/src/pages/Login.tsx && git commit -m "feat(nexus-f1): adicionar magic link no Login"
```

---

### Task 6: Webhook events selecionáveis em SettingsView

**Files:**
- Create: SQL migration adicionando `webhook_events` jsonb em `ghl_wa_tenants`
- Modify: `frontend/src/components/SettingsView.tsx`
- Modify: `frontend/src/lib/supabase.ts` (atualizar tipo `Tenant`)

- [ ] **Step 1: Migration adicionar `webhook_events`**

Criar `sql/2026-05-03-webhook-events-column.sql`:

```sql
-- 2026-05-03 BRT — F1: webhook events selecionáveis
ALTER TABLE public.ghl_wa_tenants
  ADD COLUMN IF NOT EXISTS webhook_events jsonb DEFAULT '["message_received","message_sent"]'::jsonb;

COMMENT ON COLUMN public.ghl_wa_tenants.webhook_events IS
  'Array de eventos que disparam webhook. Default: message_received, message_sent. Outros: instance_connected, instance_disconnected, qr_generated, message_failed.';

-- ROLLBACK:
-- ALTER TABLE public.ghl_wa_tenants DROP COLUMN IF EXISTS webhook_events;
```

- [ ] **Step 2: Aplicar via Mgmt API**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && curl -s -X POST \
  'https://api.supabase.com/v1/projects/bfumywvwubvernvhjehk/database/query' \
  -H 'Authorization: Bearer ${SUPABASE_MGMT_API_KEY}' \
  -H 'Content-Type: application/json' \
  -d "$(jq -Rs '{query: .}' < sql/2026-05-03-webhook-events-column.sql)"
```

Expected: `[]`. Validar:

```bash
curl -s -X POST 'https://api.supabase.com/v1/projects/bfumywvwubvernvhjehk/database/query' \
  -H 'Authorization: Bearer ${SUPABASE_MGMT_API_KEY}' \
  -H 'Content-Type: application/json' \
  -d '{"query":"SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='\''ghl_wa_tenants'\'' AND column_name='\''webhook_events'\'';"}'
```

Expected: retorna `webhook_events / jsonb / '["message_received","message_sent"]'::jsonb`.

- [ ] **Step 3: Atualizar tipo `Tenant` em supabase.ts**

Em `frontend/src/lib/supabase.ts` interface `Tenant`, adicionar:

```ts
webhook_events?: string[];
```

- [ ] **Step 4: Atualizar SettingsView com checkboxes**

Em `frontend/src/components/SettingsView.tsx`:

1. Adicionar state:
```tsx
const [webhookEvents, setWebhookEvents] = useState<string[]>(['message_received', 'message_sent']);
```

2. Em `fetchSettings`, adicionar leitura:
```tsx
// dentro do .from('ghl_wa_tenants').select(...) — adicionar 'webhook_events' aos campos
.select('name, slug, webhook_url, webhook_secret, webhook_events')
// e no setState:
if (tenantData.webhook_events) setWebhookEvents(tenantData.webhook_events);
```

3. Em `handleSave`, adicionar `webhook_events: webhookEvents` no `.update({...})`.

4. No JSX, antes do botão Save, adicionar:

```tsx
<div className="form-group">
  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
    {t('webhookEventsLabel')}
  </label>
  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
    {t('webhookEventsDescription')}
  </p>
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
    {['message_received', 'message_sent', 'message_failed', 'instance_connected', 'instance_disconnected', 'qr_generated'].map(evt => (
      <label key={evt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={webhookEvents.includes(evt)}
          onChange={(e) => {
            setWebhookEvents(prev =>
              e.target.checked
                ? [...prev, evt]
                : prev.filter(x => x !== evt)
            );
          }}
        />
        <span style={{ fontSize: '0.875rem' }}>{evt}</span>
      </label>
    ))}
  </div>
</div>
```

5. Adicionar i18n keys `webhookEventsLabel` e `webhookEventsDescription` em `frontend/src/i18n/`.

- [ ] **Step 5: Validar build**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend && pnpm build
```

Expected: build limpo. RLS UPDATE policy em `ghl_wa_tenants` ja exige owner — usuário comum não consegue salvar (Constitution Art. VI segura).

- [ ] **Step 6: Commit**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git add sql/2026-05-03-webhook-events-column.sql frontend/src/components/SettingsView.tsx frontend/src/lib/supabase.ts frontend/src/i18n/ && git commit -m "feat(nexus-f1): webhook events selecionaveis no SettingsView"
```

---

### Task 7: Backend honra `webhook_events` ao disparar webhook

**Files:**
- Modify: backend file que dispara webhook (descobrir em `src/api/webhooks/` ou `src/core/`)

- [ ] **Step 1: Localizar disparo de webhook outbound**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && grep -rn "webhook_url" src/ --include="*.ts" | grep -v "node_modules"
```

Identificar arquivo que faz o `fetch(tenant.webhook_url, ...)`.

- [ ] **Step 2: Adicionar filtro por event type**

Onde o webhook é disparado, adicionar antes do `fetch`:

```ts
const allowedEvents: string[] = tenant.webhook_events || ['message_received', 'message_sent'];
const eventName = /* nome do evento corrente, ex: 'message_received' */;
if (!allowedEvents.includes(eventName)) {
  logger.debug(`Skipping webhook ${eventName} (not in tenant.webhook_events)`);
  return;
}
```

- [ ] **Step 3: Validar TS**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && pnpm build
```

Expected: build limpo.

- [ ] **Step 4: Commit**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git add src/ && git commit -m "feat(nexus-f1): backend honra tenant.webhook_events filter"
```

---

### Task 8: Validação E2E + post-edit diagnostics gate

**Files:** none — só validação

- [ ] **Step 1: Build TS backend + frontend**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && pnpm build && cd frontend && pnpm build && pnpm lint
```

Expected: ambos limpos.

- [ ] **Step 2: Smoke local**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend && pnpm dev
```

Abrir http://localhost:5173, testar:
- Login com conta existente (Marcos terá conta de teste no Supabase Auth)
- Navegação: Sidebar deve mostrar "Messages" e ao clicar abre `MessageHistoryView` com lista
- Magic Link button: digitar email, clicar, ver mensagem verde
- Settings: ver checkboxes de webhook events, marcar 2-3, clicar save, recarregar — devem persistir

Expected (visual): nenhum erro console, tudo navegável, magic link envia.

- [ ] **Step 3: Smoke RLS**

```bash
# Como anon (sem auth header) — DEVE retornar vazio:
curl -s 'https://bfumywvwubvernvhjehk.supabase.co/rest/v1/ghl_wa_message_history?limit=1' \
  -H "apikey: $(grep VITE_SUPABASE_ANON_KEY /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway/frontend/.env 2>/dev/null | cut -d= -f2 | tr -d '\"')"
```

Expected: `[]` (RLS bloqueando). Se retornar dados, RLS não está aplicada.

- [ ] **Step 4: Atualizar task Supabase**

```bash
curl -s -X POST 'https://api.supabase.com/v1/projects/bfumywvwubvernvhjehk/database/query' \
  -H 'Authorization: Bearer ${SUPABASE_MGMT_API_KEY}' \
  -H 'Content-Type: application/json' \
  -d '{"query":"UPDATE mottivme_tasks SET status='\''review'\'' WHERE id='\''fe52f27f-f6e7-4119-b630-fa912e343a79'\'';"}'
```

(Status `review` indica aguardando QA Marcos no canary, antes de `done`.)

- [ ] **Step 5: Push branch (delegar pro agente devops conforme Constitution Art. I)**

Branch `feat/*` é two-way door — agente principal pode pushar. Mas seguir Constitution Art. II:

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && git push -u origin feat/nexus-f1-frontend-cliente
```

- [ ] **Step 6: Abrir PR via gh**

```bash
cd /Users/marcosdaniels/Projects/mottivme/GHL-Whatsapp-qr-gateway && gh pr create --title "feat(nexus-f1): frontend SPA cliente — gaps F1 fechados" --body "$(cat <<'EOF'
## Summary
- RLS multi-tenant em `ghl_wa_message_history` (gap crítico)
- MessageHistoryView roteado no AppContent (era unreachable)
- Demo User hardcoded removido do Login
- Magic link adicionado ao Login
- Webhook events selecionáveis em SettingsView + backend honra filtro

## Test plan
- [ ] Login email/senha funciona
- [ ] Magic link envia email e redireciona
- [ ] Sidebar exibe "Messages" e MessageHistoryView abre
- [ ] Settings salva webhook_events e backend filtra disparos
- [ ] RLS bloqueia query anon em ghl_wa_message_history
- [ ] Build TS limpo (backend + frontend)

Roadmap: `nexus-paridade-stevo-roadmap-2026-05-03.md` F1
Task: fe52f27f-f6e7-4119-b630-fa912e343a79
EOF
)"
```

Expected: PR aberto, URL retornada.

---

## Out of scope F1 (vai pra F2-F8)

- White-label (logo per-tenant, custom domain) → F2
- Disparo Inteligente (campanhas IA) → F3 (CampaignsView ja stub, expansão na F3)
- Send types avançados (button, list, poll) → F4
- Group ops completos → F5
- Edit/delete msg, react, reply → F6
- Labels, multi-team → F7
- IA inbox (multi-LLM, RAG) → F8

## Watchouts

- **Vercel project nexus.socialfy.me** — conferir se está apontado pra repo `GHL-Whatsapp-qr-gateway/frontend` (não confirmado nesta auditoria — Marcos confirma antes de PR ir pra prod). Canary `nexus-canary.socialfy.me` é onde testa antes de mergear.
- **Backend disparo webhook** — Task 7 depende de localizar o arquivo correto. Se o disparo está em `n8n` em vez de no backend Express, escopo muda — escalar ao Marcos.
- **Magic link email template** — Supabase Auth usa template default. Customizar template (logo MOTTIVME, copy PT-BR) é F2 white-label, não F1.
- **i18n** — frontend tem 3 línguas (en/pt/es). Adicionar keys novas em todas senão UI mostra fallback.

## Sequência crítica

Tasks devem rodar em ordem **2 → 3 → 4 → 5 → 6 → 7 → 8**. Task 1 é bootstrap. Tasks 2-7 são independentes mas Task 8 depende de todas.

Task 2 (RLS) pode rodar em paralelo com 3-7, mas execução sequencial é mais segura pra revisar commit-a-commit.
