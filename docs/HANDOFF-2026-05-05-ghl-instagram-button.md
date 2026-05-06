# HANDOFF — GHL Instagram Profile Button / Social Identity

Data: 2026-05-05 21:10 BRT
Autor: Hermes

## Objetivo

Adicionar no GHL/Socialfy um botão Instagram no contato, idealmente ao lado do botão WhatsApp, para abrir direto o perfil do lead e permitir follow-up/warm-up orgânico 15/20/30 dias depois.

## Contexto de produto

- Username do Instagram virou identidade social estratégica do lead.
- O botão precisa aparecer dentro do GHL nativo, não só no Factor AI.
- Marcos corrigiu que o formato correto de instalação é script hospedado no Nexus, tipo:

```html
<script src="https://nexus.socialfy.me/scripts/nexus-audio-recorder.js?v=1.0"></script>
<script src="https://nexus.socialfy.me/scripts/nexus-media-uploader.js?v=1.0"></script>
<script src="https://nexus.socialfy.me/scripts/nexus-message-actions.js?v=1.0"></script>
<script src="https://nexus.socialfy.me/scripts/nexus-instagram-profile.js?v=1.0"></script>
```

## Arquitetura implementada

### 1. Script público Nexus

Arquivos:

- `public/scripts/nexus-instagram-profile.js`
- `frontend/public/scripts/nexus-instagram-profile.js`

Por que em dois lugares:

- `public/scripts/` é a fonte natural dos scripts Nexus.
- O Docker atual copia `frontend/dist` para `./public` e depois copia `public/scripts/`, mas na prática o deploy estava retornando 404 para o novo script. Para garantir asset no build final do frontend/Vite também foi incluído em `frontend/public/scripts/`.

O script:

- detecta `locationId` pela URL `/v2/location/{locationId}/...`
- detecta `contactId` pela URL do contato (`/contacts/...` ou `/contacts/detail/...`)
- tenta ler Instagram visível no DOM se existir nos custom fields
- se não achar, chama endpoint Nexus:
  - `GET https://nexus.socialfy.me/api/nexus/social-identity?locationId=...&contactId=...`
- injeta botão `Instagram`
- tenta posicionar após botão/ação de WhatsApp
- se não encontrar WhatsApp no DOM, cria botão flutuante fallback
- abre `https://instagram.com/{username}`
- rejeita URLs de post/reel/stories/explore/direct/accounts como username

### 2. Endpoint Nexus para identidade social

Arquivo:

- `src/api/social-identity.controller.ts`

Rota registrada em:

- `src/index.ts`

Endpoint:

```http
GET /api/nexus/social-identity?locationId={locationId}&contactId={contactId}
```

Consulta Supabase:

- tabela: `growth_leads`
- filtros:
  - `location_id = locationId`
  - `ghl_contact_id = contactId`

Retorna:

```json
{
  "success": true,
  "found": true,
  "identity": {
    "growthLeadId": "...",
    "name": "...",
    "locationId": "...",
    "contactId": "...",
    "instagramUsername": "...",
    "instagramProfileUrl": "https://instagram.com/...",
    "source": "...",
    "confidence": "...",
    "capturedAt": "...",
    "warmupStatus": "...",
    "nextFollowupAt": "..."
  }
}
```

CORS:

- permite `app.socialfy.me`
- localhost
- domínios `*.leadconnectorhq.com`
- domínios `*.gohighlevel.com`

Sem expor Supabase key no navegador. O browser só chama Nexus.

### 3. Runtime disabled corrigido

Arquivo:

- `src/index.ts`

Problema encontrado:

- Railway estava com `NEXUS_RUNTIME_DISABLED=true`.
- O código anterior fazia `process.exit(0)` antes de subir servidor HTTP.
- Isso matava também os scripts estáticos e endpoints API.

Correção:

- agora `NEXUS_RUNTIME_DISABLED=true` mantém HTTP/API server online.
- pula apenas workers/sessões WhatsApp/cron runtime.

Trechos-chave:

- `const runtimeDisabled = process.env.NEXUS_RUNTIME_DISABLED === 'true';`
- dentro do `app.listen`, se `runtimeDisabled`, retorna antes de iniciar workers, mas servidor já está no ar.

## Commits feitos e pushados

No repo `GHL-Whatsapp-qr-gateway`, branch `main`:

- `2831d5c feat: add GHL Instagram profile button script`
- `bca3fff fix: keep Nexus HTTP server running when runtime disabled`
- `d2dc2d5 fix: include Instagram GHL script in frontend public assets`

Push feito para:

- `origin/main`
- `https://github.com/marcosdanielsf/GHL-Whatsapp-qr-gateway.git`

Deploy Railway disparado com:

```bash
railway up --detach
```

Projeto Railway detectado:

- Project: `whatsapp-ghl-gateway`
- Environment: `production`
- Service: `whatsapp-ghl-gateway`
- Domínios:
  - `https://nexus.socialfy.me`
  - `https://whatsapp-ghl-gateway-production.up.railway.app`

## Validações realizadas

### Build local

```bash
npm run build
```

Resultado: OK.

### Script syntax

```bash
node --check public/scripts/nexus-instagram-profile.js
node --check frontend/public/scripts/nexus-instagram-profile.js
```

Resultado: OK.

### Railway logs após correção runtime disabled

Logs mostraram servidor HTTP online:

```text
Nexus runtime disabled by environment; HTTP/API server will start without WhatsApp sessions/workers.
Servidor corriendo en http://localhost:8080
Nexus runtime workers skipped because NEXUS_RUNTIME_DISABLED=true
HTTP/API server ready (runtime disabled)
```

### Health check

```bash
curl -i https://nexus.socialfy.me/api/health
```

Retornou `HTTP/2 200`.

## Validação pendente/importante

A última tentativa de verificar o asset público e endpoint real foi bloqueada pela UI/usuário no Hermes antes de terminar. Comando que deveria ser reexecutado:

```bash
curl -sS -o /tmp/nexus-ig.js -w '%{http_code} %{size_download}\n' 'https://nexus.socialfy.me/scripts/nexus-instagram-profile.js?v=1.0'
node --check /tmp/nexus-ig.js
curl -sS 'https://nexus.socialfy.me/api/nexus/social-identity?locationId=8GedMLMaF26jIkHq50XG&contactId=9LcvHwqJU741EZ8D4d88' | python3 -m json.tool
```

Esperado:

- script com `HTTP 200` e tamanho > 1000 bytes
- endpoint retornando `found: true` para o contato de teste

Se ainda retornar 404 para o script:

1. Confirmar deploy Railway finalizou sem falha.
2. Conferir imagem final: Dockerfile copia `frontend/dist` para `./public` e depois `public/scripts/` para `./public/scripts/`.
3. Conferir se `frontend/public/scripts/nexus-instagram-profile.js` entrou no build Vite.
4. Conferir se `express.static(publicPath)` está servindo `/scripts/...` antes do fallback SPA.
5. Verificar se proxy/cache do domínio `nexus.socialfy.me` está apontando para a última deployment.

## Contato de teste

Location:

- `8GedMLMaF26jIkHq50XG`

Contato GHL:

- `9LcvHwqJU741EZ8D4d88`

Lead Supabase usado anteriormente:

- `c73f998f-8d2b-4238-a84b-7386df3d02be`

Instagram sincronizado esperado:

- `catarinaapcastilho`
- `https://instagram.com/catarinaapcastilho`

URL para testar no GHL:

```text
https://app.socialfy.me/v2/location/8GedMLMaF26jIkHq50XG/contacts/9LcvHwqJU741EZ8D4d88
```

## Snippet final para instalar no GHL/Socialfy

```html
<script src="https://nexus.socialfy.me/scripts/nexus-audio-recorder.js?v=1.0"></script>
<script src="https://nexus.socialfy.me/scripts/nexus-media-uploader.js?v=1.0"></script>
<script src="https://nexus.socialfy.me/scripts/nexus-message-actions.js?v=1.0"></script>
<script src="https://nexus.socialfy.me/scripts/nexus-instagram-profile.js?v=1.0"></script>
```

## Arquivos relacionados em outro repo

No repo `instagram-prospector`, foram criados também:

- `tools/ghl_social_identity_sync.py`
- `tests/test_ghl_social_identity_sync.py`
- `tools/ghl_instagram_profile_button.user.js` — versão inicial manual, substituída conceitualmente pelo script hospedado no Nexus
- `docs/ghl-instagram-button-install.md`

O worker de sync GHL já foi testado com 1 contato real antes:

- atualizou contato GHL `9LcvHwqJU741EZ8D4d88`
- adicionou tag `ig_username_captured`
- preencheu custom fields de Instagram

## Atenção para revisão Claude Opus

Pedir para revisar especialmente:

1. Robustez do detector de contato na URL do GHL.
2. Se o selector para achar WhatsApp no DOM é suficiente ou precisa adaptar ao GHL real.
3. Se CORS/origin está correto e seguro.
4. Se endpoint `/api/nexus/social-identity` deveria ter rate limit leve.
5. Se `NEXUS_RUNTIME_DISABLED=true` agora está seguro: servidor sobe, mas workers/sessões WA não sobem.
6. Confirmar por curl que `nexus-instagram-profile.js` está realmente público depois do deploy Railway.
7. Testar no browser real dentro do GHL com DevTools console aberto.

## Estado git observado

Após os commits, ainda existiam mudanças/untracked pré-existentes no repo `GHL-Whatsapp-qr-gateway` que não foram commitadas por Hermes:

- `M frontend/src/components/CampaignsView.tsx`
- `M src/infra/supabaseClient.ts`
- vários arquivos `.bkp`, `.memsearch`, `.planning`, etc.

Não misturar essas mudanças na revisão do botão Instagram.
