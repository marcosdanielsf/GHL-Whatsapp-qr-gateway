/**
 * Socialfy Nexus - Media Uploader v1.0.0
 * Envia texto e arquivos pelo Nexus dentro do GHL.
 */
(function() {
  'use strict';

  var NEXUS_API = 'https://nexus.socialfy.me/api';
  var BUTTON_ID = 'nexus-media-trigger';
  var PANEL_ID = 'nexus-media-panel';
  var TOAST_ID = 'nexus-media-toast';
  var STYLE_ID = 'nexus-media-css';
  var selectedFile = null;

  var SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 20 18-8L3 4v6l12 2-12 2v6Z"/></svg>';
  var CLIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6.5v9a4.5 4.5 0 0 1-9 0v-10a3 3 0 0 1 6 0v9a1.5 1.5 0 0 1-3 0v-8h2v8a.5.5 0 0 0 1 0v-9a2 2 0 0 0-4 0v10a2.5 2.5 0 0 0 5 0v-9h2Z"/></svg>';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#nexus-media-trigger{position:fixed;right:24px;bottom:136px;z-index:99999;height:42px;min-width:42px;padding:0 12px;border:0;border-radius:21px;background:#0f766e;color:#fff;box-shadow:0 8px 24px rgba(15,118,110,.22);display:flex;align-items:center;gap:8px;font:600 13px Inter,Arial,sans-serif;cursor:pointer;transition:transform .15s,background .15s,opacity .15s}',
      '#nexus-media-trigger:hover{transform:translateY(-1px)}',
      '#nexus-media-trigger svg,.nexus-media-btn svg{width:18px;height:18px;fill:currentColor;flex:0 0 auto}',
      '#nexus-media-trigger[disabled],.nexus-media-btn[disabled]{opacity:.6;cursor:not-allowed}',
      '#nexus-media-panel{position:fixed;right:24px;bottom:188px;z-index:100000;width:316px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 14px 38px rgba(15,23,42,.18);padding:12px;display:none;font:500 13px Inter,Arial,sans-serif;color:#111827}',
      '#nexus-media-panel.open{display:block}',
      '#nexus-media-panel textarea{width:100%;min-height:84px;resize:vertical;border:1px solid #d1d5db;border-radius:6px;padding:9px;font:500 13px Inter,Arial,sans-serif;box-sizing:border-box;outline:none}',
      '#nexus-media-panel textarea:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.12)}',
      '#nexus-media-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}',
      '.nexus-media-btn{height:34px;padding:0 10px;border:0;border-radius:6px;display:inline-flex;align-items:center;gap:6px;font:600 12px Inter,Arial,sans-serif;cursor:pointer;background:#f3f4f6;color:#374151}',
      '.nexus-media-btn.primary{background:#0f766e;color:#fff}',
      '#nexus-media-file-name{margin-top:8px;font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#nexus-media-toast{position:fixed;right:24px;bottom:236px;z-index:100001;max-width:280px;padding:10px 12px;border-radius:8px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);font:500 12px Inter,Arial,sans-serif;display:none}',
      '#nexus-media-toast.show{display:block}',
      '#nexus-media-toast.error{background:#991b1b}',
      '#nexus-media-toast.ok{background:#166534}'
    ].join('');
    document.head.appendChild(style);
  }

  function detectLocationId() {
    var nexus = window.__NEXUS__;
    if (nexus && nexus.currentLocation) return nexus.currentLocation;
    var match = window.location.pathname.match(/\/location\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function detectContactId() {
    var path = window.location.pathname;
    var match = path.match(/\/contacts\/detail\/([^/?#]+)/);
    if (match) return decodeURIComponent(match[1]);

    var links = document.querySelectorAll('a[href*="/contacts/detail/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      match = href.match(/\/contacts\/detail\/([^/?#]+)/);
      if (match) return decodeURIComponent(match[1]);
    }

    match =
      path.match(/\/conversations\/conversations\/([^/?#]+)/) ||
      path.match(/\/conversations\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getContext() {
    return {
      locationId: detectLocationId(),
      contactId: detectContactId()
    };
  }

  function isContactScreen() {
    var ctx = getContext();
    return !!(ctx.locationId && ctx.contactId);
  }

  function showToast(message, type) {
    var toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'show ' + (type || '');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function() {
      toast.className = '';
    }, 3500);
  }

  function setSending(isSending) {
    var sendBtn = document.getElementById('nexus-media-send');
    var trigger = document.getElementById(BUTTON_ID);
    if (sendBtn) {
      sendBtn.disabled = isSending;
      sendBtn.innerHTML = SEND_ICON + '<span>' + (isSending ? 'Enviando...' : 'Enviar') + '</span>';
    }
    if (trigger) trigger.disabled = isSending;
  }

  function updateFileName() {
    var el = document.getElementById('nexus-media-file-name');
    if (!el) return;
    el.textContent = selectedFile ? selectedFile.name : '';
  }

  function clearForm() {
    var messageEl = document.getElementById('nexus-media-message');
    var fileEl = document.getElementById('nexus-media-file');
    if (messageEl) messageEl.value = '';
    if (fileEl) fileEl.value = '';
    selectedFile = null;
    updateFileName();
  }

  async function sendViaNexus() {
    var ctx = getContext();
    var messageEl = document.getElementById('nexus-media-message');
    var message = messageEl ? messageEl.value.trim() : '';

    if (!ctx.locationId || !ctx.contactId) {
      showToast('Abra um contato do GHL para enviar pelo Nexus.', 'error');
      return;
    }
    if (!message && !selectedFile) {
      showToast('Digite uma mensagem ou selecione um arquivo.', 'error');
      return;
    }
    if (selectedFile && selectedFile.size > 64 * 1024 * 1024) {
      showToast('Arquivo acima de 64MB.', 'error');
      return;
    }

    try {
      setSending(true);
      var form = new FormData();
      form.append('locationId', ctx.locationId);
      form.append('contactId', ctx.contactId);
      form.append('message', message);
      if (selectedFile) form.append('file', selectedFile, selectedFile.name);

      var res = await fetch(NEXUS_API + '/nexus/media/send', {
        method: 'POST',
        body: form
      });
      var data = await res.json().catch(function() { return {}; });

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha ao enviar pelo Nexus.');
      }

      showToast('Enviado pelo Nexus.', 'ok');
      clearForm();
      var panel = document.getElementById(PANEL_ID);
      if (panel) panel.classList.remove('open');
    } catch (error) {
      showToast(error && error.message ? error.message : 'Erro ao enviar.', 'error');
    } finally {
      setSending(false);
    }
  }

  function createPanel() {
    injectCSS();

    var trigger = document.getElementById(BUTTON_ID);
    var panel = document.getElementById(PANEL_ID);

    if (!isContactScreen()) {
      if (trigger) trigger.style.display = 'none';
      if (panel) panel.classList.remove('open');
      return;
    }

    if (!trigger) {
      trigger = document.createElement('button');
      trigger.id = BUTTON_ID;
      trigger.type = 'button';
      trigger.title = 'Enviar pelo Socialfy Nexus';
      trigger.innerHTML = SEND_ICON + '<span>Nexus +</span>';
      trigger.addEventListener('click', function() {
        var currentPanel = document.getElementById(PANEL_ID);
        if (currentPanel) currentPanel.classList.toggle('open');
      });
      document.body.appendChild(trigger);
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.innerHTML = [
        '<textarea id="nexus-media-message" placeholder="Mensagem Nexus"></textarea>',
        '<input id="nexus-media-file" type="file" style="display:none" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar">',
        '<div id="nexus-media-file-name"></div>',
        '<div id="nexus-media-actions">',
          '<button type="button" id="nexus-media-attach" class="nexus-media-btn">', CLIP_ICON, '<span>Arquivo</span></button>',
          '<button type="button" id="nexus-media-send" class="nexus-media-btn primary">', SEND_ICON, '<span>Enviar</span></button>',
        '</div>'
      ].join('');
      document.body.appendChild(panel);

      document.getElementById('nexus-media-attach').addEventListener('click', function() {
        document.getElementById('nexus-media-file').click();
      });
      document.getElementById('nexus-media-file').addEventListener('change', function(event) {
        selectedFile = event.target.files && event.target.files[0] ? event.target.files[0] : null;
        updateFileName();
      });
      document.getElementById('nexus-media-send').addEventListener('click', sendViaNexus);
    }

    trigger.style.display = 'flex';
  }

  function init() {
    createPanel();
  }

  window.addEventListener('nexus:ready', init);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(init, 1000);
    });
  } else {
    setTimeout(init, 1000);
  }

  var lastPath = window.location.pathname;
  new MutationObserver(function() {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      setTimeout(init, 800);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
