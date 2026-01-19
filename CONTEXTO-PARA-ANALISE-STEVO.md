# Contexto do Projeto: Socialfy Nexus - WhatsApp Gateway

## OBJETIVO DESTA ANALISE

Preciso que você analise o **Stevo** (https://stevo.app ou documentação disponível) e me dê uma devolutiva completa sobre:
1. Como funciona a integração do Stevo com GoHighLevel
2. Quais endpoints e webhooks o Stevo usa
3. Como é o fluxo de autenticação OAuth com GHL
4. Como funciona o Custom Provider de WhatsApp no GHL
5. Quais são as diferenças entre o Stevo e nosso projeto atual

O objetivo é **igualar nosso projeto ao Stevo** em termos de funcionalidade de integração com GHL.

---

## NOSSO PROJETO ATUAL

### Visão Geral
**Nome:** Socialfy Nexus - WhatsApp Gateway
**Stack:** Node.js 20, TypeScript, Express, Baileys (@whiskeysockets/baileys), Supabase (PostgreSQL)
**Deploy:** Railway (https://whatsapp-ghl-gateway-production.up.railway.app)
**Propósito:** Gateway para integração bidirectional WhatsApp ↔ GoHighLevel

### Arquitetura

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   GoHighLevel   │────▶│  WhatsApp Gateway    │────▶│    WhatsApp     │
│   (Workflows)   │◀────│  (Node.js/Baileys)   │◀────│   (via Baileys) │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │    Supabase      │
                        │  - Sessions      │
                        │  - Queue         │
                        │  - Tenants       │
                        │  - Integrations  │
                        └──────────────────┘
```

### Funcionalidades Atuais

#### 1. Conexão WhatsApp via QR Code
- Escaneia QR uma vez, sessão persiste no Supabase
- Multi-instância (wa-01, wa-02, etc.)
- Reconexão automática

#### 2. Envio de Mensagens (Outbound: GHL → WhatsApp)
- **Endpoint:** `POST /api/ghl/outbound`
- **Body:**
```json
{
  "instanceId": "wa-01",
  "to": "+5511999999999",
  "type": "text",
  "message": "Mensagem aqui"
}
```
- Suporta texto e media
- Fila com rate-limiting (evitar ban)

#### 3. Recebimento de Mensagens (Inbound: WhatsApp → GHL)
- Quando chega mensagem no WhatsApp, enviamos para `GHL_INBOUND_URL`
- **Payload enviado:**
```json
{
  "instanceId": "wa-01",
  "from": "+5511999999999",
  "text": "mensagem recebida",
  "timestamp": 1234567890
}
```

#### 4. Multi-Tenant
- Cada tenant tem suas instâncias isoladas
- Autenticação via Supabase Auth
- RLS no banco de dados

### Endpoints da API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/health` | Health check |
| GET | `/api/wa/qr/:instanceId` | Obter QR code |
| GET | `/api/wa/status/:instanceId` | Status da instância |
| GET | `/api/wa/instances` | Listar instâncias |
| POST | `/api/wa/reconnect/:instanceId` | Reconectar |
| POST | `/api/wa/logout/:instanceId` | Desconectar |
| POST | `/api/wa/clear/:instanceId` | Limpar sessão |
| POST | `/api/send` | Enviar mensagem |
| GET | `/api/send/stats` | Estatísticas de envio |
| POST | `/api/ghl/outbound` | Webhook GHL → WhatsApp |
| POST | `/api/ghl/inbound-test` | Mock para testes inbound |
| GET | `/api/messages/history` | Histórico de mensagens |

### Schema do Banco (Supabase)

```sql
-- Tenants (empresas/clientes)
ghl_wa_tenants (
  id UUID PRIMARY KEY,
  name TEXT,
  slug TEXT UNIQUE,
  subscription_status TEXT, -- trial, active, canceled
  subscription_plan TEXT,   -- starter, pro, enterprise
  max_instances INTEGER,
  webhook_url TEXT,         -- URL para receber inbound
  webhook_secret TEXT
)

-- Usuários
ghl_wa_users (
  id UUID PRIMARY KEY,      -- auth.uid()
  tenant_id UUID REFERENCES ghl_wa_tenants,
  email TEXT,
  role TEXT                 -- owner, admin, member
)

-- Instâncias WhatsApp
ghl_wa_instances (
  id TEXT PRIMARY KEY,      -- tenant_id-wa-01
  tenant_id UUID,
  name TEXT,                -- wa-01
  phone_number TEXT,
  status TEXT
)

-- Sessões Baileys
ghl_wa_sessions (
  id UUID PRIMARY KEY,
  instance_id TEXT,
  key TEXT,                 -- creds, app-state-sync-key-xxx
  value JSONB,
  status TEXT
)

-- Fila de Mensagens
ghl_wa_message_queue (
  id BIGSERIAL PRIMARY KEY,
  instance_id TEXT,
  type TEXT,                -- text, image
  to_number TEXT,
  content TEXT,
  status TEXT,              -- pending, processing, sent, failed
  attempts INTEGER,
  next_attempt_at TIMESTAMPTZ
)

-- Integrações GHL OAuth
ghl_wa_integrations (
  id UUID PRIMARY KEY,
  tenant_id UUID,
  location_id TEXT,         -- GHL Location ID
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT,
  company_id TEXT
)
```

### Variáveis de Ambiente

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxxx
SUPABASE_ANON_KEY=eyJxxx

# GHL OAuth (ainda não implementado completamente)
GHL_CLIENT_ID=xxx
GHL_CLIENT_SECRET=xxx
GHL_REDIRECT_URI=https://xxx/api/ghl/callback

# Webhook para receber mensagens no GHL
GHL_INBOUND_URL=https://services.leadconnectorhq.com/hooks/xxx

# Config
PORT=8080
SESSION_DIR=./data/sessions
TEXT_DELAY_MS=3500
MEDIA_DELAY_MS_MIN=6000
MEDIA_DELAY_MS_MAX=9000
```

### O QUE JÁ FUNCIONA
- ✅ Conexão WhatsApp via QR
- ✅ Persistência de sessão no Supabase
- ✅ Envio de mensagens texto
- ✅ Recebimento de mensagens (inbound)
- ✅ Multi-instância
- ✅ Multi-tenant
- ✅ Painel web básico
- ✅ Deploy no Railway

### O QUE FALTA / DÚVIDAS
- ❓ Como o Stevo se integra como "Custom Provider" no GHL?
- ❓ Como funciona o OAuth flow completo com GHL?
- ❓ O GHL chama qual endpoint para enviar mensagens?
- ❓ Como registrar nosso gateway como provider de WhatsApp no GHL?
- ❓ Qual é o formato exato dos webhooks que o GHL espera?
- ❓ Como aparecer na lista de integrações do GHL?

---

## O QUE PRECISO QUE VOCÊ ANALISE NO STEVO

1. **Fluxo de Instalação**
   - Como o usuário instala o Stevo no GHL?
   - É via Marketplace? Custom App? Custom Menu Link?

2. **OAuth Flow**
   - Quais escopos o Stevo solicita?
   - Como é o callback de autorização?

3. **Integração como Custom Provider**
   - O Stevo se registra como provider de WhatsApp?
   - Se sim, como?

4. **Endpoints/Webhooks**
   - Quais webhooks o GHL chama no Stevo?
   - Qual o formato das requisições?

5. **Funcionalidades**
   - O que o Stevo faz que nós não fazemos?
   - Templates? Bulk messaging? Campanhas?

6. **UI/UX**
   - Como é o painel do Stevo dentro do GHL?
   - É embedded? Popup? Redirect?

---

## RESULTADO ESPERADO

Após analisar o Stevo, me dê:
1. **Diagrama de integração** do Stevo com GHL
2. **Lista de endpoints** que precisamos implementar
3. **Formato dos webhooks** esperados pelo GHL
4. **Passos para registrar** nosso app no GHL
5. **Gaps** entre nosso projeto e o Stevo
6. **Plano de ação** para igualar as funcionalidades

---

## LINKS ÚTEIS

- **Nosso Gateway:** https://whatsapp-ghl-gateway-production.up.railway.app
- **GHL Developer Docs:** https://highlevel.stoplight.io/docs/integrations
- **GHL Marketplace:** https://marketplace.gohighlevel.com/
- **Stevo:** https://stevo.app (analisar este)

---

## CONTEXTO ADICIONAL

Somos a **MOTTIVME**, uma empresa que desenvolve soluções de automação para agências de marketing. Nosso produto **Socialfy** precisa de integração WhatsApp com GHL para nossos clientes.

O Stevo é o principal concorrente/referência. Precisamos entender como ele funciona para replicar a integração e oferecer a mesma experiência aos nossos usuários.
