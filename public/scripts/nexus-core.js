/**
 * Socialfy Nexus - Core Bundle v1.0.0
 * Inicializa todos os módulos e gerencia estado global
 */
(function() {
  'use strict';

  const NEXUS_VERSION = '1.0.0';
  const NEXUS_API = 'https://nexus.socialfy.me/api';

  window.__NEXUS__ = window.__NEXUS__ || {
    version: NEXUS_VERSION,
    status: 'initializing',
    instances: {},
    currentLocation: null,
    modules: {}
  };

  const Nexus = window.__NEXUS__;

  function detectLocation() {
    const match = window.location.pathname.match(/\/location\/([^/]+)/);
    return match ? match[1] : null;
  }

  async function fetchStatus(locationId) {
    try {
      const res = await fetch(NEXUS_API + '/wa/status?locationId=' + locationId, {
        headers: { 'x-nexus-source': 'ghl-inject' }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch(e) {
      return null;
    }
  }

  function injectBaseCSS() {
    if (document.getElementById('nexus-base-css')) return;
    const style = document.createElement('style');
    style.id = 'nexus-base-css';
    style.textContent = `
      .nexus-badge { display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px; }
      .nexus-badge.connected { background:#dcfce7;color:#16a34a; }
      .nexus-badge.disconnected { background:#fee2e2;color:#dc2626; }
      .nexus-badge.connecting { background:#fef9c3;color:#ca8a04; }
      .nexus-dot { width:7px;height:7px;border-radius:50%;background:currentColor;animation:nexus-pulse 2s infinite; }
      @keyframes nexus-pulse { 0%,100%{opacity:1}50%{opacity:.4} }
      .nexus-btn { display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s; }
      .nexus-btn:hover { opacity:.85; }
      .nexus-btn-wa { background:#25D366;color:white; }
      .nexus-btn-secondary { background:#f3f4f6;color:#374151; }
      .nexus-float-panel { position:fixed;bottom:80px;right:24px;z-index:99999;background:white;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.12);padding:16px;min-width:260px;border:1px solid #e5e7eb;display:none; }
      .nexus-float-panel.open { display:block; }
      .nexus-float-trigger { position:fixed;bottom:24px;right:24px;z-index:99999;width:52px;height:52px;border-radius:50%;background:#25D366;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(37,211,102,.4);transition:all .2s; }
      .nexus-float-trigger:hover { transform:scale(1.08); }
      .nexus-panel-header { font-weight:700;font-size:14px;color:#111827;margin-bottom:12px;display:flex;align-items:center;gap:8px; }
      .nexus-panel-row { display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px; }
      .nexus-panel-row:last-child { border-bottom:none; }
    `;
    document.head.appendChild(style);
  }

  async function init() {
    injectBaseCSS();
    const locationId = detectLocation();
    Nexus.currentLocation = locationId;
    if (locationId) {
      const status = await fetchStatus(locationId);
      if (status) {
        Nexus.instances = status.instances || {};
        Nexus.status = status.connected ? 'connected' : 'disconnected';
      }
    }
    window.dispatchEvent(new CustomEvent('nexus:ready', { detail: Nexus }));
    console.log('[Nexus v' + NEXUS_VERSION + '] Core ready. Status: ' + Nexus.status);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 800); });
  } else {
    setTimeout(init, 800);
  }

  var lastPath = window.location.pathname;
  new MutationObserver(function() {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      setTimeout(init, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
