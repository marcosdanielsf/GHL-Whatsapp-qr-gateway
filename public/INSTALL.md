# Instalação — Socialfy Nexus no GHL

## Passo 1: Acessar configurações
GHL Agência → Configurações → Empresa → Aba **Whitelabel** → campo **JS Personalizado**

## Passo 2: Colar o código completo

```html
<!-- Socialfy Nexus - Core (obrigatório, carrega primeiro) -->
<script src="https://nexus.socialfy.me/scripts/nexus-core.js?v=1.0"></script>

<!-- Badge de status no header (verde=conectado, vermelho=desconectado) -->
<script src="https://nexus.socialfy.me/scripts/nexus-presence.js?v=1.0"></script>

<!-- Botão flutuante + painel de status no canto da tela -->
<script src="https://nexus.socialfy.me/scripts/nexus-toolkit.js?v=1.0"></script>

<!-- Gravador de áudio próprio do Nexus dentro do GHL -->
<script src="https://nexus.socialfy.me/scripts/nexus-audio-recorder.js?v=1.0"></script>

<!-- Wallpaper WhatsApp no painel de conversas -->
<script src="https://nexus.socialfy.me/scripts/nexus-bg.js?v=1.0"></script>

<!-- Switch de instâncias (opcional, útil com múltiplos números) -->
<script src="https://nexus.socialfy.me/scripts/nexus-switch.js?v=1.0"></script>
```

## Passo 3: Salvar e recarregar
Clique em **Salvar alterações** e recarregue o GHL.

## O que você verá
- 🟢 Badge **"WhatsApp ●"** no header quando conectado
- 📱 Botão flutuante verde no canto inferior direito
- 🎙️ Botão **"Audio Nexus"** nos contatos/conversas do GHL
- 🖼️ Fundo estilo WhatsApp no painel de conversas
- 🔄 Switch de instâncias (se tiver 2+ números)

## Customizações

### Trocar o wallpaper do fundo
Cole este script **antes** do nexus-bg.js:
```html
<script>window.__NEXUS_BG_URL__ = 'https://URL-DO-SEU-WALLPAPER.jpg';</script>
```

## Suporte
- Painel: https://nexus.socialfy.me
- Status API: https://nexus.socialfy.me/api/wa/status?locationId=SUA_LOCATION_ID
