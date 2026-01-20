# Progresso da Integração GHL - WhatsApp Gateway

**Data:** 2026-01-20
**Status:** 80% Concluído

---

## ✅ O QUE FOI FEITO

### 1. Código Implementado

- **`src/services/ghl.service.ts`** - Serviço centralizado para API do GHL
  - Token refresh automático
  - Busca/criação de contatos
  - Envio de mensagens inbound
  - Atualização de status de mensagens

- **`src/core/tokenRefresher.ts`** - Cron job para refresh de tokens
  - Executa a cada 30 minutos
  - Atualiza tokens que expiram em menos de 1 hora

- **`src/api/auth.controller.ts`** - OAuth callback atualizado
  - Suporta instalação via Marketplace (sem state)
  - Mostra página de sucesso após OAuth
  - Salva tokens no Supabase

- **`src/index.ts`** - Rotas adicionadas
  - `/api/oauth/callback` (alias para evitar bloqueio do GHL)
  - Token refresher iniciado no startup

### 2. Banco de Dados (Supabase)

**Tabela `ghl_wa_integrations`:**
- Alterado `location_id` de UUID para TEXT
- Alterado `tenant_id` para permitir NULL
- Adicionado unique constraint em `location_id`
- Campos: `conversation_provider_id`, `is_active`

**Tabela `ghl_wa_instances`:**
- Adicionado campo `ghl_integration_id`
- Registro criado: `wa-01` vinculado à integração

**Registro salvo:**
```sql
INSERT INTO ghl_wa_integrations (id, location_id, conversation_provider_id, is_active)
VALUES (
  '6906d196-d845-48c6-ad42-f377b6696dba',
  'cd1uyzpJox6XPt4Vct8Y',
  '696e96445f64d444760e2ae4',
  true
);

INSERT INTO ghl_wa_instances (tenant_id, name, ghl_integration_id)
VALUES (
  'e496ec12-078c-4003-b42f-d15df61bc4b7',
  'wa-01',
  '6906d196-d845-48c6-ad42-f377b6696dba'
);
```

### 3. GHL Marketplace

**App:** Socialfy Nexus
- **Client ID:** `68ecd0d94422b93a8bc8f882`
- **Client Secret:** `68ecd0d94422b93a8bc8f882-mjempkhp`
- **Conversation Provider ID:** `696e96445f64d444760e2ae4`
- **Redirect URI:** `https://nexus.socialfy.me/api/oauth/callback`
- **Delivery URL (outbound):** `https://nexus.socialfy.me/api/ghl/outbound`

**Scopes configurados:**
- conversations/message.write
- conversations.readonly
- contacts.readonly
- contacts.write
- locations.readonly

### 4. Railway (Projeto: friendly-enchantment)

**Domínio:** `nexus.socialfy.me`

**Variáveis de ambiente configuradas:**
```
GHL_CLIENT_ID=68ecd0d94422b93a8bc8f882
GHL_CLIENT_SECRET=68ecd0d94422b93a8bc8f882-mjempkhp
GHL_REDIRECT_URI=https://nexus.socialfy.me/api/oauth/callback
GHL_CONVERSATION_PROVIDER_ID=696e96445f64d444760e2ae4
```

### 5. OAuth Flow

✅ OAuth funcionando!
- Location `cd1uyzpJox6XPt4Vct8Y` conectada
- Tokens salvos no Supabase
- Página de sucesso exibida após autorização

---

## ❌ O QUE FALTA FAZER

### 1. Conversation Provider no GHL

**Problema:** O app "Socialfy Nexus" não aparece na lista de provedores de telefonia no GHL (Settings → Phone System → Provedor de telefonia).

**Investigar:**
- Verificar se o Conversation Provider foi criado corretamente no Marketplace
- O Provider ID `696e96445f64d444760e2ae4` precisa estar vinculado ao app
- Pode ser necessário configurar no GHL Marketplace → BUILD → Conversation Provider

### 2. Testar Fluxo Completo

**GHL → WhatsApp (Outbound):**
1. Conectar instância WhatsApp (sessão volátil no Railway)
2. Enviar mensagem do GHL → Conversations → WhatsApp
3. Verificar se chega em `/api/ghl/outbound`
4. Verificar se mensagem é enviada via Baileys

**WhatsApp → GHL (Inbound):**
1. Receber mensagem no WhatsApp
2. Verificar se `sendInboundToGHL()` é chamado
3. Verificar se mensagem aparece no GHL Conversations

### 3. Sessões Persistentes

**Problema:** Sessões WhatsApp são perdidas quando o container reinicia (salvas em `/tmp`).

**Solução futura:**
- Configurar volume persistente no Railway
- Ou usar armazenamento externo (S3, Supabase Storage)

---

## ARQUIVOS IMPORTANTES

```
src/
├── api/
│   ├── auth.controller.ts    # OAuth endpoints
│   └── ghl.controller.ts     # Outbound/Inbound endpoints
├── core/
│   ├── baileys.ts            # WhatsApp connection + sendInboundToGHL
│   └── tokenRefresher.ts     # Auto token refresh
├── services/
│   └── ghl.service.ts        # GHL API centralized service
└── index.ts                  # Routes setup

docs/
└── PROGRESSO-INTEGRACAO-GHL.md  # Este arquivo

supabase-ghl-integration-upgrade.sql  # Migration SQL
```

---

## COMANDOS ÚTEIS

**Testar health:**
```bash
curl https://nexus.socialfy.me/api/health
```

**Reinstalar app no GHL:**
```
https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=https%3A%2F%2Fnexus.socialfy.me%2Fapi%2Foauth%2Fcallback&client_id=68ecd0d94422b93a8bc8f882-mjempkhp&scope=conversations%2Fmessage.write+conversations.readonly+contacts.readonly+contacts.write+locations.readonly
```

**Deploy:**
```bash
cd ~/Projects/mottivme/GHL-Whatsapp-qr-gateway
git add -A && git commit -m "mensagem" && git push origin main
```

---

## PRÓXIMOS PASSOS (ao retomar)

1. **Verificar Conversation Provider** no GHL Marketplace
   - O app precisa aparecer como opção em "Provedor de telefonia"

2. **Reconectar WhatsApp** no gateway
   - Sessão é volátil, precisa escanear QR novamente

3. **Testar envio GHL → WhatsApp**
   - Enviar mensagem via GHL Conversations
   - Verificar logs do Railway

4. **Testar recebimento WhatsApp → GHL**
   - Enviar mensagem para o WhatsApp conectado
   - Verificar se aparece no GHL Conversations
