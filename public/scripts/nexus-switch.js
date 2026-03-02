/**
 * Socialfy Nexus - Instance Switch v1.0.0
 * Dropdown para trocar instância WA ativa (múltiplos números)
 */
(function() {
  'use strict';

  function createSwitch(instances) {
    if (Object.keys(instances).length < 2) return;
    if (document.getElementById('nexus-switch')) return;

    var select = document.createElement('select');
    select.id = 'nexus-switch';
    select.title = 'Trocar instância WhatsApp';
    select.style.cssText = 'font-size:12px;border:1.5px solid #25D366;border-radius:6px;padding:3px 8px;color:#111827;background:white;cursor:pointer;margin-right:8px;';

    Object.keys(instances).forEach(function(name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = '📱 ' + name + (instances[name].connected ? ' ●' : ' ○');
      opt.style.color = instances[name].connected ? '#16a34a' : '#6b7280';
      select.appendChild(opt);
    });

    // Setar instância ativa inicial
    var Nexus = window.__NEXUS__;
    if (Nexus && Nexus.instance) select.value = Nexus.instance;

    select.addEventListener('change', function() {
      if (Nexus) Nexus.activeInstance = this.value;
      window.dispatchEvent(new CustomEvent('nexus:instanceChange', { detail: { instance: this.value } }));
      console.log('[Nexus] Instância ativa:', this.value);
    });

    // Injetar no header
    var targets = ['[data-testid="header-right"]', '.header-right', 'header .flex:last-child', 'nav > div:last-child', '#nexus-presence-badge'];
    for (var i = 0; i < targets.length; i++) {
      var el = document.querySelector(targets[i]);
      if (el) {
        el.parentNode.insertBefore(select, el);
        break;
      }
    }
  }

  window.addEventListener('nexus:ready', function(e) {
    var detail = e.detail || {};
    if (detail.instances) createSwitch(detail.instances);
  });

  setTimeout(function() {
    var Nexus = window.__NEXUS__;
    if (Nexus && Nexus.instances) createSwitch(Nexus.instances);
  }, 5000);
})();
