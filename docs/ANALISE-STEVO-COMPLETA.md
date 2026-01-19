# Analise Completa: Stevo vs Socialfy Nexus

> Documento gerado em 2026-01-19 baseado na analise do Claude

## RESUMO EXECUTIVO

O Stevo funciona como **Custom Conversation Provider** do GoHighLevel. Para igualar:

1. **OAuth Flow** - Implementar autenticacao completa
2. **Custom Provider** - Registrar no Marketplace GHL
3. **Webhooks** - Adaptar formato dos endpoints
4. **Status Updates** - Notificar GHL sobre delivery/read

---

## GAPS IDENTIFICADOS

| Feature | Stevo | Socialfy | Prioridade |
|---------|-------|----------|------------|
| OAuth completo | ✅ | ❌ | P0 |
| Custom Provider | ✅ | ❌ | P0 |
| Update Status | ✅ | ❌ | P1 |
| Bulk Messaging | ✅ | ❌ | P2 |
| Transcricao Audio | ✅ | ❌ | P3 |

---

## ENDPOINTS GHL NECESSARIOS

### 1. OAuth Flow

```
GET /api/ghl/auth
  → Redireciona para GHL OAuth

GET /api/ghl/callback?code=xxx
  → Troca code por tokens
  → Salva access_token, refresh_token, locationId
```

### 2. Outbound (GHL → WhatsApp)

```
POST /api/ghl/outbound
Authorization: Bearer {instance_api_key}

{
  "contactId": "xxx",
  "locationId": "xxx",
  "messageId": "xxx",
  "phone": "+5511999999999",
  "message": "texto",
  "attachments": []
}
```

### 3. Inbound (WhatsApp → GHL)

```
POST https://services.leadconnectorhq.com/conversations/messages/inbound
Authorization: Bearer {access_token}
Version: 2021-04-15

{
  "type": "SMS",
  "contactId": "xxx",
  "conversationProviderId": "xxx",
  "message": "texto recebido",
  "direction": "inbound",
  "date": "2024-01-19T00:00:00.000Z"
}
```

### 4. Update Status

```
PUT https://services.leadconnectorhq.com/conversations/messages/{messageId}/status
Authorization: Bearer {access_token}
Version: 2021-04-15

{
  "status": "delivered" // ou "read", "failed"
}
```

---

## SCOPES OAUTH NECESSARIOS

```
conversations/message.write
conversations.readonly
contacts.readonly
contacts.write
```

---

## SCHEMA DO BANCO (ADICOES)

```sql
-- Campos novos em ghl_wa_integrations
ALTER TABLE ghl_wa_integrations ADD COLUMN IF NOT EXISTS
  conversation_provider_id TEXT,
  is_active BOOLEAN DEFAULT true;

-- Tabela de sync de contatos
CREATE TABLE IF NOT EXISTS ghl_wa_contacts_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES ghl_wa_integrations(id),
  ghl_contact_id TEXT NOT NULL,
  whatsapp_jid TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration_id, ghl_contact_id)
);

-- Tabela de campanhas
CREATE TABLE IF NOT EXISTS ghl_wa_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES ghl_wa_tenants(id),
  instance_id TEXT,
  name TEXT NOT NULL,
  message_template TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## PLANO DE IMPLEMENTACAO

### Fase 1: Core (1-2 dias)
- [ ] Implementar GET /api/ghl/auth
- [ ] Implementar GET /api/ghl/callback
- [ ] Adaptar POST /api/ghl/outbound
- [ ] Implementar POST inbound para GHL
- [ ] Implementar PUT status update

### Fase 2: Marketplace (1 dia)
- [ ] Criar Private Marketplace App
- [ ] Configurar scopes
- [ ] Registrar Custom Provider

### Fase 3: Features (2-3 dias)
- [ ] Refresh token automatico
- [ ] Bulk messaging
- [ ] Campanhas

---

## VARIAVEIS DE AMBIENTE NECESSARIAS

```bash
# GHL OAuth (obter no Marketplace)
GHL_CLIENT_ID=xxx
GHL_CLIENT_SECRET=xxx
GHL_REDIRECT_URI=https://whatsapp-ghl-gateway-production.up.railway.app/api/ghl/callback

# Conversation Provider ID (obtido apos registrar no Marketplace)
GHL_CONVERSATION_PROVIDER_ID=xxx
```

---

## REFERENCIA

- GHL Developer Docs: https://highlevel.stoplight.io/docs/integrations
- OAuth Docs: https://highlevel.stoplight.io/docs/integrations/a04191c0fabf9-authorization
- Conversations API: https://highlevel.stoplight.io/docs/integrations/d89e71c7030b7-conversations-api
