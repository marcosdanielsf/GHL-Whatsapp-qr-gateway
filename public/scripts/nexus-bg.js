/**
 * Socialfy Nexus - WhatsApp Background v1.0.0
 * Aplica wallpaper estilo WhatsApp no painel de conversas do GHL
 */
(function() {
  'use strict';
  var BG_URL = window.__NEXUS_BG_URL__ || 'https://i.pinimg.com/originals/97/c0/07/97c00759d90d786d9b6096d274ad3e07.png';

  function applyBackground() {
    var panel = document.querySelector('#conversation-panel');
    if (!panel || panel.dataset.nexusBg === '1') return;
    panel.style.setProperty('background-image', 'url("' + BG_URL + '")', 'important');
    panel.style.setProperty('background-size', 'auto', 'important');
    panel.style.setProperty('background-repeat', 'repeat', 'important');
    panel.style.setProperty('background-position', 'center', 'important');
    panel.dataset.nexusBg = '1';
    // Tornar containers intermediários transparentes
    panel.querySelectorAll('.m-3, [class*="bg-white"]:not([class*="chat"]):not([class*="message"])').forEach(function(el) {
      if (!el.querySelector('[class*="message"]') && !el.closest('[class*="message"]')) {
        el.style.setProperty('background-color', 'transparent', 'important');
      }
    });
    console.log('[Nexus] Background aplicado');
  }

  var obs = new MutationObserver(function() {
    var panel = document.querySelector('#conversation-panel');
    if (panel && panel.dataset.nexusBg !== '1') applyBackground();
  });

  function start() {
    applyBackground();
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(start, 1200); });
  } else {
    setTimeout(start, 1200);
  }
})();
