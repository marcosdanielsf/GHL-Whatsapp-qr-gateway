/**
 * Socialfy Nexus - Presence/Status v1.0.0
 * Mostra badge de status WA conectado/desconectado no header do GHL
 */
(function() {
  'use strict';

  var NEXUS_API = 'https://nexus.socialfy.me/api';
  var refreshInterval = null;

  function createBadge(status) {
    var badge = document.createElement('div');
    badge.id = 'nexus-presence-badge';
    badge.className = 'nexus-badge ' + (status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected');
    var dot = document.createElement('span');
    dot.className = 'nexus-dot';
    var label = document.createElement('span');
    label.textContent = status === 'connected' ? 'WhatsApp ●' : status === 'connecting' ? 'Conectando...' : 'WA Offline';
    badge.appendChild(dot);
    badge.appendChild(label);
    badge.title = 'Socialfy Nexus - ' + (status === 'connected' ? 'Conectado' : 'Desconectado');
    badge.style.cursor = 'pointer';
    badge.addEventListener('click', function() {
      window.open('https://nexus.socialfy.me', '_blank');
    });
    return badge;
  }

  function updateBadge(status) {
    var existing = document.getElementById('nexus-presence-badge');
    var newBadge = createBadge(status);
    if (existing) {
      existing.replaceWith(newBadge);
    } else {
      // Tentar injetar no header do GHL
      var headerTargets = [
        '.header-right',
        '[class*="header"] [class*="right"]',
        '.hl-header-right',
        'header .flex',
        '[class*="topbar"]',
        'nav'
      ];
      var injected = false;
      for (var i = 0; i < headerTargets.length; i++) {
        var target = document.querySelector(headerTargets[i]);
        if (target) {
          newBadge.style.marginRight = '8px';
          target.prepend(newBadge);
          injected = true;
          break;
        }
      }
      if (!injected) {
        // Fallback: canto superior direito fixo
        newBadge.style.position = 'fixed';
        newBadge.style.top = '12px';
        newBadge.style.right = '200px';
        newBadge.style.zIndex = '99998';
        document.body.appendChild(newBadge);
      }
    }
  }

  async function checkStatus() {
    var Nexus = window.__NEXUS__;
    var locationId = Nexus && Nexus.currentLocation;
    if (!locationId) return;
    try {
      var res = await fetch(NEXUS_API + '/nexus/status?locationId=' + locationId);
      if (res.ok) {
        var data = await res.json();
        var status = data.connected ? 'connected' : 'disconnected';
        updateBadge(status);
        if (Nexus) Nexus.status = status;
      } else {
        updateBadge('disconnected');
      }
    } catch(e) {
      updateBadge('disconnected');
    }
  }

  function init() {
    var Nexus = window.__NEXUS__;
    var status = (Nexus && Nexus.status !== 'initializing') ? Nexus.status : 'connecting';
    updateBadge(status);
    checkStatus();
    // Atualizar a cada 30s
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(checkStatus, 30000);
  }

  window.addEventListener('nexus:ready', init);
  setTimeout(function() {
    if (!document.getElementById('nexus-presence-badge')) init();
  }, 3000);

})();
