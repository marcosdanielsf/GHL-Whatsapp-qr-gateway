/*
 * Socialfy De-GHL Kit v0.2.3
 * Camada agressiva de white-label visual para app.socialfy.me / GHL.
 * Não coleta dados, não usa credenciais e não chama APIs.
 */
(function socialfyDeGhlKit() {
  'use strict';

  var VERSION = '0.2.3';
  var STYLE_LINK_ID = 'socialfy-deghl-kit-css-link';
  var INLINE_STYLE_ID = 'socialfy-deghl-kit-inline-css';
  var OBSERVER_KEY = '__socialfyDeGhlObserver';
  var RUN_TIMER_KEY = '__socialfyDeGhlRunTimer';
  var lastRun = 0;

  var remoteCssHref = 'https://nexus.socialfy.me/scripts/socialfy-deghl-kit.css?v=' + VERSION;
  var inlineCss = "/*\n * Socialfy De-GHL Kit v0.2.3\n * Camada agressiva de white-label visual para app.socialfy.me / GHL.\n * N\u00e3o coleta dados, n\u00e3o usa credenciais e n\u00e3o chama APIs.\n */\n:root {\n  --sf-navy-950: #020617;\n  --sf-navy-900: #071126;\n  --sf-navy-800: #0b1f4d;\n  --sf-blue-700: #1e40ff;\n  --sf-blue-600: #2563eb;\n  --sf-cyan: #38d5ff;\n  --sf-lime: #a3ff12;\n  --sf-ink: #101828;\n  --sf-muted: #667085;\n  --sf-line: #e7edf6;\n  --sf-page: #f3f7fb;\n  --sf-card: #ffffff;\n  --sf-radius-sm: 12px;\n  --sf-radius: 18px;\n  --sf-radius-lg: 26px;\n  --sf-shadow-soft: 0 16px 45px rgba(15, 23, 42, .10);\n  --sf-shadow-blue: 0 18px 45px rgba(30, 64, 255, .18);\n}\n\nhtml,\nbody {\n  background: var(--sf-page) !important;\n  color: var(--sf-ink) !important;\n  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif !important;\n}\n\nbody.socialfy-deghl-kit-loaded {\n  -webkit-font-smoothing: antialiased;\n  text-rendering: geometricPrecision;\n}\n\n/* ---------- Login/auth surfaces ---------- */\nhtml.lead-connector,\n.hl_login,\nbody:has(.login-page-width) {\n  background:\n    radial-gradient(circle at 18% 12%, rgba(30, 64, 255, .16), transparent 30%),\n    radial-gradient(circle at 82% 18%, rgba(56, 213, 255, .12), transparent 28%),\n    linear-gradient(135deg, #f8fbff 0%, #eef4ff 100%) !important;\n}\n\n.hl_login--header { padding: 22px 30px !important; }\n.hl_login--header img[alt*=\"Logotipo\"],\n.hl_login--header img[alt*=\"logo\" i] {\n  max-height: 34px !important;\n  width: auto !important;\n  object-fit: contain !important;\n}\n.hl_login .card,\n#app .login-page-width {\n  border: 1px solid rgba(231, 237, 246, .95) !important;\n  border-radius: 28px !important;\n  box-shadow: 0 32px 100px rgba(2, 6, 23, .16) !important;\n  overflow: hidden !important;\n  background: rgba(255, 255, 255, .92) !important;\n  backdrop-filter: blur(20px) saturate(1.15) !important;\n}\n.hl_login .card-body { padding: 36px !important; }\n.hl_login .heading2,\n.login-card-heading .heading2,\n#app .hl-display-sm-semibold {\n  color: var(--sf-ink) !important;\n  font-size: 26px !important;\n  letter-spacing: -.045em !important;\n  font-weight: 850 !important;\n}\n.hl_login .hl-text-input,\n.hl_login input,\n.hl_login select,\n#app .n-input {\n  border-radius: 14px !important;\n  border-color: var(--sf-line) !important;\n  min-height: 46px !important;\n  box-shadow: none !important;\n  background: #fbfdff !important;\n}\n#app .n-input__border,\n#app .n-input__state-border { border-radius: 14px !important; }\n.hl_login .hl-text-input:focus,\n.hl_login input:focus,\n.hl_login select:focus,\n#app .n-input:focus-within {\n  border-color: var(--sf-blue-700) !important;\n  box-shadow: 0 0 0 5px rgba(30, 64, 255, .12) !important;\n}\n.hl_login .hl-btn,\n.hl-btn.bg-curious-blue-500,\nbutton.bg-curious-blue-500,\nbutton[class*=\"bg-curious-blue\"],\n#app #login--button {\n  border-radius: 14px !important;\n  background: linear-gradient(135deg, var(--sf-blue-700), #0b2ea8) !important;\n  border-color: transparent !important;\n  box-shadow: var(--sf-shadow-blue) !important;\n  font-weight: 800 !important;\n}\n.hl_login .hl-btn:hover,\n.hl-btn.bg-curious-blue-500:hover,\nbutton.bg-curious-blue-500:hover,\nbutton[class*=\"bg-curious-blue\"]:hover,\n#app #login--button:hover {\n  background: linear-gradient(135deg, #0b2ea8, #061b45) !important;\n  transform: translateY(-1px);\n}\n\n/* ---------- App interno: trocar DNA visual do GHL ---------- */\nbody.socialfy-deghl-kit-loaded:not(:has(.login-page-width)) {\n  background: #f4f7fb !important;\n}\n\n/* Sidebar principal */\n#sidebar-v2,\n.sidebar-v2-agency,\n.sidebar-v2-location,\n[class*=\"sidebar-v2\"],\naside[class*=\"sidebar\"],\nnav[class*=\"sidebar\"] {\n  background:\n    linear-gradient(180deg, rgba(15, 23, 42, .08), transparent 18%),\n    radial-gradient(circle at 30% 0%, rgba(56, 213, 255, .18), transparent 28%),\n    linear-gradient(180deg, #071126 0%, #061234 44%, #020617 100%) !important;\n  border-right: 0 !important;\n  box-shadow: 18px 0 55px rgba(2, 6, 23, .18) !important;\n}\n\n#sidebar-v2 *,\n.sidebar-v2-agency *,\n.sidebar-v2-location * {\n  letter-spacing: -.01em;\n}\n\n/* Logo/brand block */\n#sidebar-v2 img,\n.sidebar-v2-agency img,\n.sidebar-v2-location img {\n  filter: saturate(1.2) contrast(1.05) !important;\n}\n\n/* Switcher de location vira card premium */\n#sidebar-v2 [class*=\"location\"],\n#sidebar-v2 [class*=\"company\"],\n.sidebar-v2-agency [class*=\"location\"],\n.sidebar-v2-location [class*=\"location\"] {\n  border-radius: 20px !important;\n}\n\n/* Itens de menu */\n#sidebar-v2 a,\n#sidebar-v2 button,\n.sidebar-v2-agency a,\n.sidebar-v2-agency button,\n.sidebar-v2-location a,\n.sidebar-v2-location button,\n[class*=\"sidebar-v2\"] a,\n[class*=\"sidebar-v2\"] button {\n  border-radius: 16px !important;\n  transition: background .18s ease, color .18s ease, transform .18s ease, opacity .18s ease !important;\n}\n#sidebar-v2 a:hover,\n#sidebar-v2 button:hover,\n.sidebar-v2-agency a:hover,\n.sidebar-v2-agency button:hover,\n.sidebar-v2-location a:hover,\n.sidebar-v2-location button:hover {\n  background: rgba(255, 255, 255, .09) !important;\n  transform: translateX(2px);\n}\n#sidebar-v2 a[aria-current=\"page\"],\n#sidebar-v2 button[aria-current=\"page\"],\n.sidebar-v2-agency a[aria-current=\"page\"],\n.sidebar-v2-agency button[aria-current=\"page\"],\n.sidebar-v2-location a[aria-current=\"page\"],\n.sidebar-v2-location button[aria-current=\"page\"] {\n  background: linear-gradient(135deg, rgba(255,255,255,.16), rgba(56,213,255,.10)) !important;\n  box-shadow: inset 3px 0 0 var(--sf-cyan), 0 12px 30px rgba(0,0,0,.14) !important;\n  color: #fff !important;\n}\n\n/* Conte\u00fado: cards mais produto pr\u00f3prio */\n#app main,\n#app [role=\"main\"],\n.hl-wrapper-container,\n.hl-wrapper-container-fluid,\n#location-dashboard,\n#location-conversations,\n#location-calendar,\n[id*=\"dashboard\"],\n[id*=\"calendar\"],\n[id*=\"conversation\"] {\n  background: #f4f7fb !important;\n}\n\n/* N\u00e3o escurecer pain\u00e9is internos: sidebar escura, trabalho claro. */\nbody.socialfy-deghl-kit-loaded .hl-wrapper-container,\nbody.socialfy-deghl-kit-loaded .hl-wrapper-container-fluid,\nbody.socialfy-deghl-kit-loaded main > div,\nbody.socialfy-deghl-kit-loaded [role=\"main\"] > div {\n  color: var(--sf-ink) !important;\n}\n\nbody.socialfy-deghl-kit-loaded h1,\nbody.socialfy-deghl-kit-loaded h2,\nbody.socialfy-deghl-kit-loaded h3,\nbody.socialfy-deghl-kit-loaded [class*=\"title\"],\nbody.socialfy-deghl-kit-loaded [class*=\"heading\"] {\n  color: var(--sf-ink) !important;\n}\n\n#app .card,\n#app [class*=\"card\"],\n#app [class*=\"panel\"],\n#app [class*=\"drawer\"],\n#app [class*=\"contact\"],\n#app [class*=\"details\"] {\n  border-color: var(--sf-line) !important;\n}\n\nbody.socialfy-deghl-kit-loaded .card,\nbody.socialfy-deghl-kit-loaded [class*=\"dashboard\"] [class*=\"card\"],\nbody.socialfy-deghl-kit-loaded [class*=\"panel\"],\nbody.socialfy-deghl-kit-loaded [class*=\"drawer\"] {\n  background-color: #fff !important;\n}\n\n/* Header/topbar: menos GHL, mais command center */\n#app header,\n#app [class*=\"topbar\"],\n#app [class*=\"header\"]:not(.hl_login--header) {\n  border-color: rgba(231, 237, 246, .85) !important;\n}\n\n/* Conversas: trocar o cheiro visual por inbox propriet\u00e1rio */\nbody.socialfy-deghl-kit-loaded [class*=\"conversation\"] [class*=\"message\"],\nbody.socialfy-deghl-kit-loaded [class*=\"messageBubble\"],\nbody.socialfy-deghl-kit-loaded [class*=\"bubble\"] {\n  border-radius: 20px !important;\n}\n\nbody.socialfy-deghl-kit-loaded textarea,\nbody.socialfy-deghl-kit-loaded input[type=\"text\"],\nbody.socialfy-deghl-kit-loaded input[type=\"search\"],\nbody.socialfy-deghl-kit-loaded input[type=\"email\"],\nbody.socialfy-deghl-kit-loaded input[type=\"tel\"],\nbody.socialfy-deghl-kit-loaded [contenteditable=\"true\"] {\n  border-radius: 16px !important;\n}\n\n/* Bot\u00f5es e badges globais */\nbody.socialfy-deghl-kit-loaded button,\nbody.socialfy-deghl-kit-loaded .btn,\nbody.socialfy-deghl-kit-loaded [role=\"button\"] {\n  border-radius: 14px !important;\n}\nbody.socialfy-deghl-kit-loaded .bg-blue-600,\nbody.socialfy-deghl-kit-loaded .bg-curious-blue-500,\nbody.socialfy-deghl-kit-loaded [class*=\"bg-blue\"],\nbody.socialfy-deghl-kit-loaded [class*=\"bg-curious-blue\"] {\n  background: linear-gradient(135deg, var(--sf-blue-700), #0b2ea8) !important;\n}\n\n/* Esconder/diminuir elementos que gritam GHL quando aparecem */\nbody.socialfy-deghl-kit-loaded [title*=\"GoHighLevel\" i],\nbody.socialfy-deghl-kit-loaded [aria-label*=\"GoHighLevel\" i],\nbody.socialfy-deghl-kit-loaded [alt*=\"GoHighLevel\" i],\nbody.socialfy-deghl-kit-loaded [title*=\"HighLevel\" i],\nbody.socialfy-deghl-kit-loaded [aria-label*=\"HighLevel\" i],\nbody.socialfy-deghl-kit-loaded [alt*=\"HighLevel\" i],\nbody.socialfy-deghl-kit-loaded [href*=\"gohighlevel\" i],\nbody.socialfy-deghl-kit-loaded [href*=\"leadconnector\" i] {\n  opacity: 0 !important;\n  pointer-events: none !important;\n}\n\n/* Widgets flutuantes: ficam menos \u00f3bvios */\nbody.socialfy-deghl-kit-loaded iframe[title*=\"chat\" i],\nbody.socialfy-deghl-kit-loaded [class*=\"floating\"],\nbody.socialfy-deghl-kit-loaded [class*=\"launcher\"] {\n  border-radius: 22px !important;\n}\n\n/* Marca discreta do kit \u2014 sem badge vermelho de teste */\nbody.socialfy-deghl-kit-loaded::after {\n  content: \"Socialfy OS\";\n  position: fixed;\n  right: 16px;\n  bottom: 14px;\n  z-index: 2147483000;\n  padding: 7px 10px;\n  border-radius: 999px;\n  background: rgba(2, 6, 23, .58);\n  color: #fff;\n  font: 800 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;\n  pointer-events: none;\n  opacity: .14;\n  backdrop-filter: blur(12px);\n}\n\n/* Pequeno modo stealth: esconde Launchpad se JS marcar */\nbody.socialfy-stealth [data-sf-hide=\"true\"] {\n  display: none !important;\n}\n\n\n/* v0.2.1 contrast safety net: if a route uses a white workspace, never inherit the dark shell. */\nbody.socialfy-deghl-kit-loaded:not(:has(.login-page-width)) [style*=\"background: rgb(255\"],\nbody.socialfy-deghl-kit-loaded:not(:has(.login-page-width)) [style*=\"background-color: rgb(255\"] {\n  color: var(--sf-ink) !important;\n}\n\nbody.socialfy-deghl-kit-loaded .n-button,\nbody.socialfy-deghl-kit-loaded .n-input,\nbody.socialfy-deghl-kit-loaded .n-card {\n  background-color: #fff !important;\n}\n\nbody.socialfy-deghl-kit-loaded .fc,\nbody.socialfy-deghl-kit-loaded [class*=\"calendar\"],\nbody.socialfy-deghl-kit-loaded [class*=\"Calendar\"] {\n  background-color: #fff !important;\n  color: var(--sf-ink) !important;\n}\n\n\n/* v0.2.2 login brand fix: remove marca/\u00edcone padr\u00e3o e coloca wordmark Socialfy consistente. */\nbody:has(.login-page-width) #app img[alt*=\"Socialfy\" i],\nbody:has(.login-page-width) #app img[alt*=\"HighLevel\" i],\nbody:has(.login-page-width) #app img[alt*=\"LeadConnector\" i],\nbody:has(.login-page-width) #app img[alt*=\"logo\" i],\nbody:has(.login-page-width) #app img[alt*=\"Logotipo\" i] {\n  opacity: 0 !important;\n  visibility: hidden !important;\n}\n\nbody:has(.login-page-width) #app::before {\n  content: \"Socialfy\";\n  position: fixed;\n  left: 78px;\n  top: 76px;\n  z-index: 2147482000;\n  color: #071126;\n  font: 900 24px/1 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n  letter-spacing: -.04em;\n  pointer-events: none;\n}\n\nbody:has(.login-page-width) #app::after {\n  content: \"\";\n  position: fixed;\n  left: 48px;\n  top: 72px;\n  z-index: 2147482000;\n  width: 20px;\n  height: 28px;\n  border-radius: 10px 10px 6px 6px;\n  background: linear-gradient(145deg, #1e40ff 0%, #38d5ff 100%);\n  box-shadow: 10px 7px 0 rgba(30, 64, 255, .24), 18px -3px 0 rgba(56, 213, 255, .28);\n  transform: rotate(-24deg);\n  pointer-events: none;\n}\n\nbody:has(.login-page-width).socialfy-deghl-kit-loaded::after {\n  opacity: 0 !important;\n  display: none !important;\n}\n\nbody:has(.login-page-width) .login-page-width {\n  margin-top: 32px !important;\n}\n\n\n/* v0.2.3 sidebar state fix: n\u00e3o deixar subcamadas/\u00edcones ativos virarem p\u00edlulas cinza por cima do menu. */\n#sidebar-v2 .active:not(a):not(button),\n.sidebar-v2-agency .active:not(a):not(button),\n.sidebar-v2-location .active:not(a):not(button),\n[class*=\"sidebar-v2\"] .active:not(a):not(button) {\n  background: transparent !important;\n  box-shadow: none !important;\n}\n\n#sidebar-v2 a,\n#sidebar-v2 button,\n.sidebar-v2-agency a,\n.sidebar-v2-agency button,\n.sidebar-v2-location a,\n.sidebar-v2-location button,\n[class*=\"sidebar-v2\"] a,\n[class*=\"sidebar-v2\"] button {\n  color: rgba(238, 244, 255, .82) !important;\n}\n\n#sidebar-v2 a:hover,\n#sidebar-v2 button:hover,\n.sidebar-v2-agency a:hover,\n.sidebar-v2-agency button:hover,\n.sidebar-v2-location a:hover,\n.sidebar-v2-location button:hover,\n[class*=\"sidebar-v2\"] a:hover,\n[class*=\"sidebar-v2\"] button:hover {\n  color: #ffffff !important;\n}\n\n#sidebar-v2 a[aria-current=\"page\"] *,\n#sidebar-v2 button[aria-current=\"page\"] *,\n.sidebar-v2-agency a[aria-current=\"page\"] *,\n.sidebar-v2-agency button[aria-current=\"page\"] *,\n.sidebar-v2-location a[aria-current=\"page\"] *,\n.sidebar-v2-location button[aria-current=\"page\"] * {\n  color: #ffffff !important;\n  opacity: 1 !important;\n}\n\n/* Caso o GHL pinte s\u00f3 o \u00edcone/miolo como ativo, for\u00e7a transparente. */\n#sidebar-v2 a > .active,\n#sidebar-v2 button > .active,\n.sidebar-v2-agency a > .active,\n.sidebar-v2-agency button > .active,\n.sidebar-v2-location a > .active,\n.sidebar-v2-location button > .active {\n  background: transparent !important;\n  box-shadow: none !important;\n}\n";

  var textReplacements = [
    ['Esqueceu a password?', 'Esqueceu sua senha?'],
    ['Faça login em sua conta', 'Acesse sua conta'],
    ['Acesse sua conta Socialfy', 'Acesse sua conta'],
    ['Seu endereço de e-mail', 'Seu e-mail profissional'],
    ['A senha que você escolheu', 'Sua senha'],
    ['Ou Continuar com', 'Ou continue com'],
    ['Fazer login com o Google', 'Entrar com Google'],
    ['Ao fazer login, você concorda com nossos Termos e condições', 'Ao entrar, você concorda com nossos termos de uso.'],
    ['Carregando dados novos...', 'Carregando Socialfy OS...'],
    ['Initializing...', 'Preparando sua central...'],
    ['Launchpad', 'Início'],
    ['Painel de controle', 'Comando'],
    ['Dashboard', 'Comando'],
    ['Conversations', 'Inbox'],
    ['Conversas', 'Inbox'],
    ['Calendários', 'Agenda'],
    ['Calendar', 'Agenda'],
    ['Contatos', 'Clientes'],
    ['Contacts', 'Clientes'],
    ['Leads', 'Oportunidades'],
    ['Opportunities', 'Pipeline'],
    ['Pagamentos', 'Recebimentos'],
    ['Payments', 'Recebimentos'],
    ['Automações', 'Fluxos'],
    ['Automation', 'Fluxos'],
    ['Marketing', 'Campanhas'],
    ['Trechos', 'Respostas rápidas'],
    ['Snippets', 'Respostas rápidas'],
    ['Links de acionamento', 'Links inteligentes'],
    ['Trigger Links', 'Links inteligentes'],
    ['Estatísticas', 'Insights'],
    ['Statistics', 'Insights'],
    ['Configurações', 'Ajustes'],
    ['Settings', 'Ajustes'],
    ['Webphones', 'Telefonia'],
    ['Webphone', 'Telefonia'],
    ['Ask AI', 'Copiloto'],
    ['Pergunte a IA', 'Copiloto'],
    ['Pergunte à IA', 'Copiloto'],
    ['AI Studio', 'Estúdio IA'],
    ['Agentes de AI', 'Agentes IA'],
    ['Análises De Call', 'Qualidade de Calls'],
    ['Revisões De Agente', 'QA de Agentes'],
    ['Caixa de entrada do grupo', 'Inbox de conversas'],
    ['Detalhes do contato', 'Perfil do cliente'],
    ['Todos os campos', 'Dados'],
    ['Registros de auditoria', 'Histórico'],
    ['Não lidos', 'Pendentes'],
    ['Todos', 'Tudo'],
    ['Recentes', 'Recentes'],
    ['Digite uma mensagem...', 'Responder pelo Socialfy...']
  ];

  var regexReplacements = [
    [/go\s*high\s*level/ig, 'Socialfy'],
    [/gohighlevel/ig, 'Socialfy'],
    [/highlevel/ig, 'Socialfy'],
    [/leadconnector/ig, 'Socialfy'],
    [/lead\s*connector/ig, 'Socialfy'],
    [/Ask\s*AI/g, 'Copiloto'],
    [/Pergunte\s*[aà]\s*IA/ig, 'Copiloto']
  ];

  var attributeReplacements = [
    ['placeholder', 'Seu endereço de e-mail', 'Seu e-mail profissional'],
    ['placeholder', 'A senha que você escolheu', 'Sua senha'],
    ['placeholder', 'Digite uma mensagem...', 'Responder pelo Socialfy...'],
    ['aria-label', 'Ir para a página inicial', 'Ir para o início'],
    ['aria-label', 'Mostrar senha', 'Mostrar senha']
  ];

  var menuAliases = {
    'Launchpad': 'Início',
    'Painel de controle': 'Comando',
    'Conversas': 'Inbox',
    'Calendários': 'Agenda',
    'Contatos': 'Clientes',
    'Leads': 'Oportunidades',
    'Análises De Call': 'Qualidade de Calls',
    'Objeções': 'Playbooks',
    'Agentes': 'Agentes',
    'Revisões De Agente': 'QA de Agentes',
    'Pagamentos': 'Recebimentos',
    'AI Studio': 'Estúdio IA',
    'Agentes de AI': 'Agentes IA',
    'Marketing': 'Campanhas',
    'Automações': 'Fluxos',
    'Configurações': 'Ajustes'
  };

  function injectCssLink() {
    if (document.getElementById(STYLE_LINK_ID)) return;
    var link = document.createElement('link');
    link.id = STYLE_LINK_ID;
    link.rel = 'stylesheet';
    link.href = remoteCssHref;
    document.head.appendChild(link);
  }

  function injectFallbackCss() {
    var existing = document.getElementById(INLINE_STYLE_ID);
    if (existing) {
      if (existing.getAttribute('data-version') !== VERSION) existing.textContent = inlineCss;
      existing.setAttribute('data-version', VERSION);
      return;
    }
    var style = document.createElement('style');
    style.id = INLINE_STYLE_ID;
    style.setAttribute('data-version', VERSION);
    style.textContent = inlineCss;
    document.head.appendChild(style);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function swapString(value) {
    if (!value) return value;
    var next = value;
    var normalized = normalizeText(value);
    for (var i = 0; i < textReplacements.length; i++) {
      if (normalized === textReplacements[i][0]) {
        return value.replace(textReplacements[i][0], textReplacements[i][1]);
      }
    }
    for (var j = 0; j < regexReplacements.length; j++) {
      next = next.replace(regexReplacements[j][0], regexReplacements[j][1]);
    }
    return next;
  }

  function replaceExactText(root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'].indexOf(parent.tagName) !== -1) return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest('[data-sf-ignore="true"]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var node;
    while ((node = walker.nextNode())) {
      var next = swapString(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  }

  function replaceAttributes(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var elements = scope.querySelectorAll('input,textarea,button,a,img,[aria-label],[placeholder],[title],[alt]');
    for (var i = 0; i < elements.length; i++) {
      for (var j = 0; j < attributeReplacements.length; j++) {
        var attr = attributeReplacements[j][0];
        var from = attributeReplacements[j][1];
        var to = attributeReplacements[j][2];
        if (elements[i].getAttribute(attr) === from) elements[i].setAttribute(attr, to);
      }
      ['aria-label', 'placeholder', 'title', 'alt'].forEach(function(attr) {
        var value = elements[i].getAttribute(attr);
        var next = swapString(value);
        if (next !== value) elements[i].setAttribute(attr, next);
      });
    }
  }

  function relabelMenuItems() {
    var selectors = [
      '#sidebar-v2 a', '#sidebar-v2 button',
      '.sidebar-v2-agency a', '.sidebar-v2-agency button',
      '.sidebar-v2-location a', '.sidebar-v2-location button',
      '[class*="sidebar-v2"] a', '[class*="sidebar-v2"] button'
    ].join(',');
    var items = document.querySelectorAll(selectors);
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var text = normalizeText(item.innerText || item.textContent || '');
      if (!text) continue;
      Object.keys(menuAliases).forEach(function(from) {
        if (text === from || text.indexOf(from) === 0) {
          item.setAttribute('data-sf-menu-original', from);
          var nodes = [];
          var walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
              if (normalizeText(node.nodeValue) === from) return NodeFilter.FILTER_ACCEPT;
              return NodeFilter.FILTER_SKIP;
            }
          });
          var node;
          while ((node = walker.nextNode())) nodes.push(node);
          nodes.forEach(function(node) { node.nodeValue = node.nodeValue.replace(from, menuAliases[from]); });
        }
      });
    }
  }

  function hideNoisyLaunchpad() {
    var candidates = document.querySelectorAll('a,button,[role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var text = normalizeText(candidates[i].innerText || candidates[i].textContent || '');
      if (text === 'Launchpad') candidates[i].setAttribute('data-sf-hide', 'true');
    }
  }

  function addAppShellSignals() {
    if (!document.body) return;
    document.body.classList.add('socialfy-deghl-kit-loaded');
    document.body.classList.add('socialfy-stealth');
    document.documentElement.setAttribute('data-socialfy-deghl-version', VERSION);

    var title = document.querySelector('title');
    if (title) title.textContent = swapString(title.textContent || 'Socialfy');

    var logos = document.querySelectorAll('img[alt*="Logotipo"], img[alt*="logo" i], img[alt*="HighLevel" i], img[alt*="LeadConnector" i]');
    for (var i = 0; i < logos.length; i++) {
      logos[i].setAttribute('alt', 'Socialfy');
      logos[i].onerror = function() { this.style.visibility = 'hidden'; };
    }
  }

  function run(root) {
    var now = Date.now();
    if (now - lastRun < 80) return;
    lastRun = now;
    injectCssLink();
    injectFallbackCss();
    if (!document.body) return;
    replaceExactText(root || document.body);
    replaceAttributes(root || document);
    relabelMenuItems();
    hideNoisyLaunchpad();
    addAppShellSignals();
  }

  function scheduleRun(root) {
    if (window[RUN_TIMER_KEY]) window.clearTimeout(window[RUN_TIMER_KEY]);
    window[RUN_TIMER_KEY] = window.setTimeout(function() { run(root || document.body); }, 50);
  }

  function boot() {
    run(document.body || document.documentElement);
    window.setTimeout(function() { run(document.body || document.documentElement); }, 600);
    window.setTimeout(function() { run(document.body || document.documentElement); }, 1800);
    if (window[OBSERVER_KEY]) return;
    window[OBSERVER_KEY] = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
          scheduleRun(document.body);
          return;
        }
      }
    });
    window[OBSERVER_KEY].observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
