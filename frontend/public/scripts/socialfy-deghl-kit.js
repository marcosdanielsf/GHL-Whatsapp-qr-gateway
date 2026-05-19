/*
 * Socialfy De-GHL Kit v0.1.0
 * Reescreve microcopy e injeta CSS de branding no GHL/Socialfy.
 * Não coleta dados, não usa credenciais e não chama APIs.
 */
(function socialfyDeGhlKit() {
  'use strict';

  var VERSION = '0.1.1';
  var STYLE_LINK_ID = 'socialfy-deghl-kit-css-link';
  var INLINE_STYLE_ID = 'socialfy-deghl-kit-inline-css';
  var OBSERVER_KEY = '__socialfyDeGhlObserver';
  var lastRun = 0;

  var remoteCssHref = 'https://nexus.socialfy.me/scripts/socialfy-deghl-kit.css?v=' + VERSION;

  var textReplacements = [
    ['Esqueceu a password?', 'Esqueceu sua senha?'],
    ['Faça login em sua conta', 'Acesse sua conta Socialfy'],
    ['Seu endereço de e-mail', 'Seu e-mail profissional'],
    ['A senha que você escolheu', 'Sua senha'],
    ['Ou Continuar com', 'Ou continue com'],
    ['Fazer login com o Google', 'Entrar com Google'],
    ['Ao fazer login, você concorda com nossos Termos e condições', 'Ao entrar, você concorda com nossos termos de uso.'],
    ['Carregando dados novos...', 'Carregando Socialfy...'],
    ['Initializing...', 'Preparando sua área...']
  ];

  var attributeReplacements = [
    ['placeholder', 'Seu endereço de e-mail', 'Seu e-mail profissional'],
    ['placeholder', 'A senha que você escolheu', 'Sua senha'],
    ['aria-label', 'Ir para a página inicial', 'Ir para o início'],
    ['aria-label', 'Mostrar senha', 'Mostrar senha']
  ];

  function injectCssLink() {
    if (document.getElementById(STYLE_LINK_ID)) return;
    var link = document.createElement('link');
    link.id = STYLE_LINK_ID;
    link.rel = 'stylesheet';
    link.href = remoteCssHref;
    document.head.appendChild(link);
  }

  function injectFallbackCss() {
    if (document.getElementById(INLINE_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = INLINE_STYLE_ID;
    style.textContent = `/*
 * Socialfy De-GHL Kit v0.1.0
 * Branding leve para reduzir aparência padrão GoHighLevel/LeadConnector.
 * Seguro para carregar via Custom CSS/JS; não acessa dados sensíveis.
 */
:root {
  --socialfy-bg: #f6f7fb;
  --socialfy-surface: #ffffff;
  --socialfy-primary: #2563eb;
  --socialfy-primary-dark: #1d4ed8;
  --socialfy-text: #111827;
  --socialfy-muted: #6b7280;
  --socialfy-border: #e5e7eb;
  --socialfy-radius: 14px;
  --socialfy-shadow: 0 18px 55px rgba(15, 23, 42, .10);
}

html.lead-connector,
body,
.hl_login {
  background: radial-gradient(circle at 18% 12%, rgba(37, 99, 235, .12), transparent 28%), var(--socialfy-bg) !important;
  color: var(--socialfy-text) !important;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
}

.hl_login--header {
  padding: 22px 28px !important;
}

.hl_login--header img[alt*="Logotipo"],
.hl_login--header img[alt*="logo" i] {
  max-height: 32px !important;
  width: auto !important;
  object-fit: contain !important;
}

.hl_login .card {
  border: 1px solid rgba(229, 231, 235, .9) !important;
  border-radius: 22px !important;
  box-shadow: var(--socialfy-shadow) !important;
  overflow: hidden !important;
}

.hl_login .card-body {
  padding: 34px !important;
}

.hl_login .heading2,
.login-card-heading .heading2 {
  color: var(--socialfy-text) !important;
  font-size: 24px !important;
  letter-spacing: -.03em !important;
  font-weight: 800 !important;
}

.hl_login .hl-text-input,
.hl_login input,
.hl_login select {
  border-radius: 12px !important;
  border-color: var(--socialfy-border) !important;
  min-height: 44px !important;
  box-shadow: none !important;
}

.hl_login .hl-text-input:focus,
.hl_login input:focus,
.hl_login select:focus {
  border-color: var(--socialfy-primary) !important;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, .12) !important;
}

.hl_login .hl-btn,
.hl-btn.bg-curious-blue-500,
button.bg-curious-blue-500,
button[class*="bg-curious-blue"] {
  border-radius: 12px !important;
  background: linear-gradient(135deg, var(--socialfy-primary), var(--socialfy-primary-dark)) !important;
  border-color: transparent !important;
  box-shadow: 0 10px 24px rgba(37, 99, 235, .20) !important;
  font-weight: 750 !important;
}

.hl_login .hl-btn:hover,
.hl-btn.bg-curious-blue-500:hover,
button.bg-curious-blue-500:hover,
button[class*="bg-curious-blue"]:hover {
  background: linear-gradient(135deg, #1d4ed8, #1e40af) !important;
  transform: translateY(-1px);
}

.hl_login .forgot-password,
.hl_login a.text-curious-blue-500,
a[class*="text-curious-blue"] {
  color: var(--socialfy-primary) !important;
}

.hl_login .foot-note,
.hl_login .text-gray-500,
.hl_login .language-label {
  color: var(--socialfy-muted) !important;
}

/* Remove alguns cheiros visuais padrão do GHL sem quebrar navegação. */
.hl-loader-info:where(:not(:empty)) {
  font-weight: 650 !important;
  color: var(--socialfy-muted) !important;
}

/* Sidebar/app interno: ajustes conservadores e reversíveis. */
.sidebar-v2-agency [class*="sidebar"],
.sidebar-v2-location [class*="sidebar"] {
  font-family: inherit !important;
}

.sidebar-v2-agency button,
.sidebar-v2-agency a,
.sidebar-v2-location button,
.sidebar-v2-location a {
  border-radius: 10px !important;
}

/* Badge para confirmar visualmente que o kit carregou, discreto e removível. */
body.socialfy-deghl-kit-loaded::after {
  content: "Socialfy";
  position: fixed;
  right: 16px;
  bottom: 14px;
  z-index: 2147483000;
  padding: 6px 9px;
  border-radius: 999px;
  background: rgba(17, 24, 39, .82);
  color: #fff;
  font: 700 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  pointer-events: none;
  opacity: .42;
}
`;
    document.head.appendChild(style);
  }

  function replaceExactText(root) {
    var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent || ['SCRIPT', 'STYLE', 'TEXTAREA'].indexOf(parent.tagName) !== -1) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var node;
    while ((node = walker.nextNode())) {
      var value = node.nodeValue;
      var trimmed = value.replace(/\s+/g, ' ').trim();
      for (var i = 0; i < textReplacements.length; i++) {
        if (trimmed === textReplacements[i][0]) {
          node.nodeValue = value.replace(textReplacements[i][0], textReplacements[i][1]);
          break;
        }
      }
    }
  }

  function replaceAttributes(root) {
    var elements = (root || document).querySelectorAll ? (root || document).querySelectorAll('input,button,a,img,[aria-label],[placeholder]') : [];
    for (var i = 0; i < elements.length; i++) {
      for (var j = 0; j < attributeReplacements.length; j++) {
        var attr = attributeReplacements[j][0];
        var from = attributeReplacements[j][1];
        var to = attributeReplacements[j][2];
        if (elements[i].getAttribute(attr) === from) elements[i].setAttribute(attr, to);
      }
    }
  }

  function softenGhlFootprints() {
    document.body.classList.add('socialfy-deghl-kit-loaded');

    var loginLogo = document.querySelector('.hl_login--header img[alt*="Logotipo"], .hl_login--header img[alt*="logo" i]');
    if (loginLogo) {
      loginLogo.setAttribute('alt', 'Socialfy');
      loginLogo.onerror = function() { this.style.visibility = 'hidden'; };
    }

    var title = document.querySelector('title');
    if (title && /HighLevel|LeadConnector|GoHighLevel/i.test(title.textContent || '')) {
      title.textContent = 'Socialfy';
    }
  }

  function run(root) {
    var now = Date.now();
    if (now - lastRun < 120) return;
    lastRun = now;
    injectCssLink();
    injectFallbackCss();
    if (!document.body) return;
    replaceExactText(root || document.body);
    replaceAttributes(root || document);
    softenGhlFootprints();
  }

  function boot() {
    run(document.body || document.documentElement);
    if (window[OBSERVER_KEY]) return;
    window[OBSERVER_KEY] = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
          run(document.body);
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
