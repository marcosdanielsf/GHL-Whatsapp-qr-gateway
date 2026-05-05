/**
 * Socialfy Nexus - Message Actions v1.0.0
 * Reage e apaga mensagens do WhatsApp a partir do historico Nexus no GHL.
 */
(function() {
  'use strict';

  var NEXUS_API = 'https://nexus.socialfy.me/api';
  var BUTTON_ID = 'nexus-actions-trigger';
  var PANEL_ID = 'nexus-actions-panel';
  var LIST_ID = 'nexus-actions-list';
  var TOAST_ID = 'nexus-actions-toast';
  var STYLE_ID = 'nexus-actions-css';
  var latestMessages = [];
  var loadingMessages = false;
  var inlineObserverStarted = false;

  var HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.5-10-9.1C-.2 7.8 2.4 3.5 6.8 3.5c2 0 3.7 1 5.2 2.8 1.5-1.8 3.2-2.8 5.2-2.8 4.4 0 7 4.3 4.8 8.4C19.5 16.5 12 21 12 21Z"/></svg>';
  var TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21c-1.1 0-2-.9-2-2V7h14v12c0 1.1-.9 2-2 2H7ZM9 4h6l1 1h4v2H4V5h4l1-1Zm0 5v9h2V9H9Zm4 0v9h2V9h-2Z"/></svg>';
  var ACTION_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v10H7l-3 3V4Zm4 13h9l3 3v-4h-2v1.2L17.8 15H8v2Z"/></svg>';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#nexus-actions-trigger{position:fixed;right:24px;bottom:184px;z-index:99999;height:42px;min-width:42px;padding:0 12px;border:0;border-radius:21px;background:#1d4ed8;color:#fff;box-shadow:0 8px 24px rgba(29,78,216,.22);display:none;align-items:center;gap:8px;font:600 13px Inter,Arial,sans-serif;cursor:pointer;transition:transform .15s,opacity .15s}',
      '#nexus-actions-trigger:hover{transform:translateY(-1px)}',
      '#nexus-actions-trigger svg,.nexus-actions-icon-btn svg{width:18px;height:18px;fill:currentColor;flex:0 0 auto}',
      '#nexus-actions-trigger[disabled],.nexus-actions-icon-btn[disabled]{opacity:.6;cursor:not-allowed}',
      '#nexus-actions-panel{position:fixed;right:24px;bottom:236px;z-index:100000;width:348px;max-height:430px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 14px 38px rgba(15,23,42,.18);display:none;font:500 13px Inter,Arial,sans-serif;color:#111827;overflow:hidden}',
      '#nexus-actions-panel.open{display:block}',
      '#nexus-actions-header{height:44px;padding:0 12px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;font-weight:700}',
      '#nexus-actions-refresh{border:0;background:#f3f4f6;color:#374151;border-radius:6px;height:28px;padding:0 9px;font:600 12px Inter,Arial,sans-serif;cursor:pointer}',
      '#nexus-actions-list{max-height:360px;overflow:auto}',
      '.nexus-actions-empty{padding:18px 12px;color:#6b7280;font-size:12px;text-align:center}',
      '.nexus-actions-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:10px 12px;border-bottom:1px solid #f3f4f6;align-items:center}',
      '.nexus-actions-row:last-child{border-bottom:0}',
      '.nexus-actions-meta{display:flex;align-items:center;gap:6px;margin-bottom:4px;color:#6b7280;font-size:11px}',
      '.nexus-actions-dir{border-radius:999px;padding:2px 7px;background:#eef2ff;color:#3730a3;font-weight:700}',
      '.nexus-actions-dir.outbound{background:#dcfce7;color:#166534}',
      '.nexus-actions-preview{font-size:12px;line-height:1.35;color:#111827;word-break:break-word}',
      '.nexus-actions-buttons{display:flex;gap:6px}',
      '.nexus-actions-icon-btn{width:32px;height:32px;border:0;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:#f3f4f6;color:#374151}',
      '.nexus-actions-icon-btn.like{background:#fee2e2;color:#b91c1c}',
      '.nexus-actions-icon-btn.delete{background:#f3f4f6;color:#4b5563}',
      '.nexus-inline-actions{display:flex;align-items:center;gap:5px;margin:4px 0 8px 0;max-width:max-content;opacity:.96;position:relative;z-index:5}',
      '.nexus-inline-actions.outbound{margin-left:auto;margin-right:6px}',
      '.nexus-inline-action-btn{width:30px;height:30px;border:1px solid rgba(148,163,184,.34);border-radius:8px;background:rgba(255,255,255,.9);color:#475569;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(15,23,42,.08);transition:transform .12s,background .12s,color .12s}',
      '.nexus-inline-action-btn:hover{transform:translateY(-1px);background:#fff;color:#0f172a}',
      '.nexus-inline-action-btn.like{color:#dc2626}',
      '.nexus-inline-action-btn.delete{color:#64748b}',
      '.nexus-inline-action-btn svg{width:17px;height:17px;fill:currentColor}',
      '#nexus-actions-toast{position:fixed;right:24px;bottom:294px;z-index:100001;max-width:300px;padding:10px 12px;border-radius:8px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);font:500 12px Inter,Arial,sans-serif;display:none}',
      '#nexus-actions-toast.show{display:block}',
      '#nexus-actions-toast.error{background:#991b1b}',
      '#nexus-actions-toast.ok{background:#166534}'
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

  function setBusy(isBusy) {
    var trigger = document.getElementById(BUTTON_ID);
    var buttons = document.querySelectorAll('.nexus-actions-icon-btn,.nexus-inline-action-btn,#nexus-actions-refresh');
    if (trigger) trigger.disabled = isBusy;
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = isBusy;
  }

  async function requestJson(url, options) {
    var res = await fetch(url, options || {});
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha na acao Nexus.');
    }
    return data;
  }

  function formatDirection(direction) {
    return direction === 'outbound' ? 'enviada' : 'recebida';
  }

  function renderMessages(messages) {
    var list = document.getElementById(LIST_ID);
    if (!list) return;
    if (!messages || !messages.length) {
      list.innerHTML = '<div class="nexus-actions-empty">Sem mensagens acionaveis ainda. Envie ou receba uma nova mensagem pelo Nexus.</div>';
      return;
    }

    list.innerHTML = messages.map(function(message) {
      var dirClass = message.direction === 'outbound' ? ' outbound' : '';
      return [
        '<div class="nexus-actions-row" data-history-id="', message.id, '">',
          '<div>',
            '<div class="nexus-actions-meta">',
              '<span class="nexus-actions-dir', dirClass, '">', formatDirection(message.direction), '</span>',
            '</div>',
            '<div class="nexus-actions-preview">', escapeHtml(message.preview || ''), '</div>',
          '</div>',
          '<div class="nexus-actions-buttons">',
            '<button type="button" class="nexus-actions-icon-btn like" data-action="react" title="Curtir no WhatsApp">', HEART_ICON, '</button>',
            '<button type="button" class="nexus-actions-icon-btn delete" data-action="delete" title="Apagar no WhatsApp">', TRASH_ICON, '</button>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function loadMessages(renderPanel) {
    var ctx = getContext();
    if (!ctx.locationId || !ctx.contactId) {
      showToast('Abra um contato do GHL para usar as acoes.', 'error');
      return;
    }
    if (loadingMessages) return;

    try {
      loadingMessages = true;
      setBusy(true);
      var params = new URLSearchParams({
        locationId: ctx.locationId,
        contactId: ctx.contactId,
        limit: '12'
      });
      var data = await requestJson(NEXUS_API + '/nexus/actions/messages?' + params.toString());
      latestMessages = data.messages || [];
      if (renderPanel !== false) renderMessages(latestMessages);
      injectInlineActions();
    } catch (error) {
      latestMessages = [];
      if (renderPanel !== false) renderMessages([]);
      showToast(error && error.message ? error.message : 'Erro ao carregar mensagens.', 'error');
    } finally {
      loadingMessages = false;
      setBusy(false);
    }
  }

  async function runAction(historyId, action) {
    var ctx = getContext();
    if (!ctx.locationId || !ctx.contactId || !historyId) return;

    if (action === 'delete' && !window.confirm('Apagar esta mensagem no WhatsApp?')) {
      return;
    }

    try {
      setBusy(true);
      await requestJson(NEXUS_API + '/nexus/actions/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: ctx.locationId,
          contactId: ctx.contactId,
          historyId: historyId,
          emoji: action === 'react' ? '\uD83D\uDC4D' : undefined
        })
      });
      showToast(action === 'react' ? 'Curtida enviada.' : 'Mensagem apagada.', 'ok');
      await loadMessages(false);
    } catch (error) {
      showToast(error && error.message ? error.message : 'Erro na acao.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function normalizeMatchText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function getConversationPanel() {
    return (
      document.querySelector('#conversation-panel') ||
      document.querySelector('[data-testid*="conversation"]') ||
      document.querySelector('[class*="conversation"]') ||
      document.body
    );
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 14;
  }

  function isComposerNode(el) {
    return !!(
      el.closest('textarea') ||
      el.closest('input') ||
      el.closest('[contenteditable="true"]') ||
      el.closest('[role="textbox"]')
    );
  }

  function bestNeedlesFor(message) {
    var texts = Array.isArray(message.matchTexts) && message.matchTexts.length
      ? message.matchTexts
      : [message.preview || ''];

    return texts
      .map(normalizeMatchText)
      .filter(function(text) { return text.length >= 3; })
      .map(function(text) { return text.length > 72 ? text.slice(0, 72) : text; });
  }

  function findBubbleForMessage(message) {
    var panel = getConversationPanel();
    var needles = bestNeedlesFor(message);
    if (!needles.length) return null;

    var nodes = Array.prototype.slice.call(panel.querySelectorAll('div,span,p'));
    var matches = [];

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!isVisible(node) || isComposerNode(node) || node.closest('.nexus-inline-actions')) continue;

      var text = normalizeMatchText(node.textContent || '');
      if (!text || text.length > 800) continue;

      for (var n = 0; n < needles.length; n++) {
        if (text.indexOf(needles[n]) >= 0) {
          matches.push(node);
          break;
        }
      }
    }

    matches.sort(function(a, b) {
      return (a.textContent || '').length - (b.textContent || '').length;
    });

    for (var m = 0; m < matches.length; m++) {
      var bubble = chooseBubbleHost(matches[m]);
      if (bubble && !bubble.dataset.nexusActionsMessageId) return bubble;
    }

    return null;
  }

  function chooseBubbleHost(node) {
    var current = node;
    var best = node;
    var depth = 0;

    while (current && current !== document.body && depth < 7) {
      var text = current.textContent || '';
      var rect = current.getBoundingClientRect ? current.getBoundingClientRect() : null;
      if (rect && rect.width >= 80 && rect.width <= 760 && text.length <= 500) {
        best = current;
      }
      current = current.parentElement;
      depth++;
    }

    return best;
  }

  function buildInlineToolbar(message) {
    var toolbar = document.createElement('div');
    toolbar.className = 'nexus-inline-actions ' + (message.direction === 'outbound' ? 'outbound' : 'inbound');
    toolbar.dataset.historyId = message.id;
    toolbar.innerHTML = [
      '<button type="button" class="nexus-inline-action-btn like" data-action="react" title="Curtir no WhatsApp">', HEART_ICON, '</button>',
      '<button type="button" class="nexus-inline-action-btn delete" data-action="delete" title="Apagar no WhatsApp">', TRASH_ICON, '</button>'
    ].join('');
    return toolbar;
  }

  function injectInlineActions() {
    if (!isContactScreen() || !latestMessages.length) return;

    for (var i = 0; i < latestMessages.length; i++) {
      var message = latestMessages[i];
      if (!message || !message.id || document.querySelector('.nexus-inline-actions[data-history-id="' + message.id + '"]')) {
        continue;
      }

      var bubble = findBubbleForMessage(message);
      if (!bubble) continue;

      var toolbar = buildInlineToolbar(message);
      bubble.dataset.nexusActionsMessageId = message.id;
      bubble.insertAdjacentElement('afterend', toolbar);
    }
  }

  function startInlineObserver() {
    if (inlineObserverStarted) return;
    inlineObserverStarted = true;

    document.addEventListener('click', function(event) {
      var button = event.target.closest && event.target.closest('.nexus-inline-action-btn');
      if (!button) return;
      var toolbar = button.closest('.nexus-inline-actions');
      if (!toolbar) return;
      runAction(toolbar.getAttribute('data-history-id'), button.getAttribute('data-action'));
    });

    var scheduleTimer = null;
    new MutationObserver(function() {
      clearTimeout(scheduleTimer);
      scheduleTimer = setTimeout(function() {
        injectInlineActions();
      }, 350);
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(function() {
      if (isContactScreen()) loadMessages(false);
    }, 15000);
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

    if (!window.__NEXUS_FORCE_ACTIONS_PANEL__) {
      if (trigger) trigger.style.display = 'none';
      if (panel) panel.classList.remove('open');
      return;
    }

    if (!trigger) {
      trigger = document.createElement('button');
      trigger.id = BUTTON_ID;
      trigger.type = 'button';
      trigger.title = 'Acoes WhatsApp pelo Socialfy Nexus';
      trigger.innerHTML = ACTION_ICON + '<span>Acoes</span>';
      trigger.addEventListener('click', function() {
        var currentPanel = document.getElementById(PANEL_ID);
        if (!currentPanel) return;
        currentPanel.classList.toggle('open');
        if (currentPanel.classList.contains('open')) loadMessages();
      });
      document.body.appendChild(trigger);
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.innerHTML = [
        '<div id="nexus-actions-header">',
          '<span>Acoes WhatsApp</span>',
          '<button type="button" id="nexus-actions-refresh">Atualizar</button>',
        '</div>',
        '<div id="', LIST_ID, '"><div class="nexus-actions-empty">Carregando...</div></div>'
      ].join('');
      document.body.appendChild(panel);

      document.getElementById('nexus-actions-refresh').addEventListener('click', loadMessages);
      panel.addEventListener('click', function(event) {
        var button = event.target.closest && event.target.closest('.nexus-actions-icon-btn');
        if (!button) return;
        var row = button.closest('.nexus-actions-row');
        if (!row) return;
        runAction(row.getAttribute('data-history-id'), button.getAttribute('data-action'));
      });
    }

    trigger.style.display = 'flex';
  }

  function init() {
    injectCSS();
    startInlineObserver();
    createPanel();
    if (isContactScreen()) loadMessages(false);
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
