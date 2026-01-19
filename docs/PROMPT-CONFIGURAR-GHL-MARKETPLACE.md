# Prompt para Claude Browser - Configurar GHL Marketplace App

Cole este prompt no Claude browser e siga as instruções dele navegando pelo Marketplace.

---

## PROMPT

```
Preciso da sua ajuda para configurar meu app "Socialfy Nexus" no GoHighLevel Marketplace para funcionar como Custom Conversation Provider de WhatsApp.

## CONTEXTO

Estou no GHL Marketplace (https://marketplace.gohighlevel.com) e já tenho um app criado:
- **Nome:** Socialfy Nexus
- **Status:** Live
- **Tipo:** White-label, Private
- **Target:** Sub-Account

Meu backend está em: https://whatsapp-ghl-gateway-production.up.railway.app

## O QUE PRECISO CONFIGURAR

### 1. Auth Section (OAuth)
Preciso verificar/configurar:
- **Client ID** e **Client Secret** (me mostre onde encontrar)
- **Redirect URI:** `https://whatsapp-ghl-gateway-production.up.railway.app/api/ghl/callback`
- **Scopes necessários:**
  - `conversations/message.write`
  - `conversations.readonly`
  - `contacts.readonly`
  - `contacts.write`
  - `locations.readonly`

### 2. Conversation Provider (CRÍTICO)
Preciso configurar o app como Custom Conversation Provider:
- **Provider Name:** WhatsApp
- **Provider Type:** SMS (ou Custom se disponível)
- **Delivery URL (Webhook):** `https://whatsapp-ghl-gateway-production.up.railway.app/api/ghl/outbound`
- **Marcar:** "Is this a Custom Conversation Provider" ✓

### 3. Webhooks
Configurar webhook para receber eventos:
- **URL:** `https://whatsapp-ghl-gateway-production.up.railway.app/api/ghl/webhook`
- **Events:** ConversationProviderOutbound, ContactCreate, ContactUpdate

## INSTRUÇÕES

1. Me guie passo a passo por cada seção do app no Marketplace
2. Me diga exatamente onde clicar e o que preencher
3. Me peça screenshots quando precisar ver o estado atual
4. Me avise se alguma configuração estiver errada
5. No final, me dê o Client ID e Client Secret para eu configurar no backend

## PERGUNTAS QUE PRECISO RESPONDER

1. Onde encontro as credenciais OAuth (Client ID/Secret)?
2. Como configuro o app como Conversation Provider?
3. Os scopes estão corretos?
4. O Redirect URI está configurado?
5. O webhook de outbound está configurado?

Por favor, comece me pedindo para acessar a página de configuração do app e me guie a partir daí.
```

---

## NAVEGAÇÃO ESPERADA

O Claude browser deve te guiar por estas seções:

### 1. Acessar App Settings
- Clique em "Socialfy Nex..." na lista
- Ou vá em "My Apps" → selecione o app

### 2. Seção "Auth"
Aqui você encontra:
- Client ID
- Client Secret
- Redirect URIs (adicionar a nossa)
- Scopes (verificar se estão corretos)

### 3. Seção "Distribution" ou "Marketplace Listing"
- Configurações de como o app aparece

### 4. Seção "Conversation Provider" ou "Features"
- Aqui configura o Custom Conversation Provider
- Delivery URL para webhooks

### 5. Seção "Webhooks"
- URLs para receber eventos do GHL

---

## CHECKLIST DE CONFIGURAÇÃO

Após configurar, verifique:

- [ ] **Client ID** copiado
- [ ] **Client Secret** copiado
- [ ] **Redirect URI** configurado: `https://whatsapp-ghl-gateway-production.up.railway.app/api/ghl/callback`
- [ ] **Scopes** incluem: `conversations/message.write`, `conversations.readonly`, `contacts.readonly`, `contacts.write`
- [ ] **Conversation Provider** habilitado
- [ ] **Delivery URL** configurado: `https://whatsapp-ghl-gateway-production.up.railway.app/api/ghl/outbound`
- [ ] **Webhook URL** configurado (opcional)

---

## DEPOIS DE CONFIGURAR

Me passe:
1. **GHL_CLIENT_ID:** xxx
2. **GHL_CLIENT_SECRET:** xxx
3. **GHL_CONVERSATION_PROVIDER_ID:** xxx (se disponível)

E eu configuro no Railway e implemento o OAuth completo.
