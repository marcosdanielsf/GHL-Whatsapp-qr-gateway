/*
 * Socialfy De-GHL Kit v0.1.0
 * Reescreve microcopy e injeta CSS de branding no GHL/Socialfy.
 * Não coleta dados, não usa credenciais e não chama APIs.
 */
(function socialfyDeGhlKit() {
  'use strict';

  var VERSION = '0.1.0';
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
    style.textContent = [
      'body.socialfy-deghl-kit-loaded .hl_login .card{border-radius:22px!important;box-shadow:0 18px 55px rgba(15,23,42,.10)!important}',
      'body.socialfy-deghl-kit-loaded .hl_login .heading2{font-size:24px!important;font-weight:800!important;letter-spacing:-.03em!important}',
      'body.socialfy-deghl-kit-loaded .hl_login .hl-btn{border-radius:12px!important;background:linear-gradient(135deg,#2563eb,#1d4ed8)!important;border-color:transparent!important}',
      'body.socialfy-deghl-kit-loaded .hl_login input{border-radius:12px!important;min-height:44px!important}'
    ].join('');
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
