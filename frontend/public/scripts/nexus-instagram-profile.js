/**
 * Socialfy Nexus - Instagram Profile Button v1.0.0
 * Injeta botao Instagram no GHL/Socialfy ao lado das acoes do contato.
 */
(function() {
  'use strict';

  var NEXUS_API = 'https://nexus.socialfy.me/api';
  var BUTTON_ID = 'nexus-instagram-profile-button';
  var STYLE_ID = 'nexus-instagram-profile-css';
  var TOAST_ID = 'nexus-instagram-profile-toast';
  var CACHE_TTL_MS = 60 * 1000;
  var cache = {};
  var loadingKey = '';

  var IG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 12 16.5 4.5 4.5 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 12 14.5 2.5 2.5 0 0 0 12 9.5ZM17.75 6.3a1.05 1.05 0 1 1-1.05 1.05 1.05 1.05 0 0 1 1.05-1.05Z"/></svg>';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#nexus-instagram-profile-button{height:34px;min-width:34px;padding:0 10px;border:1px solid rgba(219,39,119,.32);border-radius:8px;background:rgba(236,72,153,.10);color:#db2777;display:inline-flex;align-items:center;justify-content:center;gap:6px;font:700 12px Inter,Arial,sans-serif;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform .15s,background .15s,color .15s,border-color .15s}',
      '#nexus-instagram-profile-button:hover{transform:translateY(-1px);background:rgba(236,72,153,.18);border-color:rgba(219,39,119,.48);color:#be185d;text-decoration:none}',
      '#nexus-instagram-profile-button svg{width:16px;height:16px;fill:currentColor;flex:0 0 auto}',
      '#nexus-instagram-profile-button.nexus-ig-floating{position:fixed;right:24px;bottom:282px;z-index:99999;height:42px;border-radius:21px;box-shadow:0 8px 24px rgba(219,39,119,.18);background:#db2777;color:#fff;border:0}',
      '#nexus-instagram-profile-toast{position:fixed;right:24px;bottom:334px;z-index:100001;max-width:300px;padding:10px 12px;border-radius:8px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);font:500 12px Inter,Arial,sans-serif;display:none}',
      '#nexus-instagram-profile-toast.show{display:block}'
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
    var match =
      path.match(/\/contacts\/detail\/([^/?#]+)/) ||
      path.match(/\/contacts\/([^/?#]+)/);
    if (match) return decodeURIComponent(match[1]);

    var links = document.querySelectorAll('a[href*="/contacts/detail/"],a[href*="/contacts/"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      match = href.match(/\/contacts\/detail\/([^/?#]+)/) || href.match(/\/contacts\/([^/?#]+)/);
      if (match) return decodeURIComponent(match[1]);
    }

    return '';
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

  function showToast(message) {
    var toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'show';
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(function() {
      toast.className = '';
    }, 3200);
  }

  function normalizeUsername(raw) {
    if (!raw) return '';
    var value = String(raw).trim().replace(/^@+/, '');
    var urlMatch = value.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
    if (urlMatch) value = urlMatch[1];
    value = value.split(/[/?#\s]/)[0].replace(/^@+/, '').trim();
    if (!value) return '';
    if (/^(p|reel|reels|stories|explore|direct|accounts)$/i.test(value)) return '';
    return /^[a-zA-Z0-9._]{1,30}$/.test(value) ? value : '';
  }

  function profileUrlFromText(raw) {
    if (!raw) return '';
    var text = String(raw);
    var urlMatch = text.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i);
    var username = normalizeUsername(urlMatch ? urlMatch[0] : text);
    return username ? 'https://instagram.com/' + username : '';
  }

  function visibleText(el) {
    return (el && el.innerText ? el.innerText : '').replace(/\s+/g, ' ').trim();
  }

  function findInstagramInDom() {
    var labels = ['Instagram Profile URL', 'Instagram Username', 'Instagram', 'IG Username', 'IG Profile URL'];
    var all = Array.prototype.slice.call(document.querySelectorAll('div,section,article,label,p,span'));

    for (var l = 0; l < labels.length; l++) {
      var label = labels[l];
      var lowerLabel = label.toLowerCase();
      for (var i = 0; i < all.length; i++) {
        var text = visibleText(all[i]);
        if (text.toLowerCase().indexOf(lowerLabel) === -1) continue;

        var container = all[i].closest('[class*="field"],[class*="custom"],[class*="form"],div') || all[i].parentElement || all[i];
        var fromContainer = profileUrlFromText(visibleText(container).replace(new RegExp(label, 'ig'), ''));
        if (fromContainer) return fromContainer;

        if (all[i].nextElementSibling) {
          var fromNext = profileUrlFromText(visibleText(all[i].nextElementSibling));
          if (fromNext) return fromNext;
        }
      }
    }

    var links = document.querySelectorAll('a[href*="instagram.com"]');
    for (var j = 0; j < links.length; j++) {
      var fromHref = profileUrlFromText(links[j].getAttribute('href'));
      if (fromHref) return fromHref;
    }
    return '';
  }

  async function fetchIdentity(ctx) {
    var key = ctx.locationId + ':' + ctx.contactId;
    var cached = cache[key];
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.url;
    if (loadingKey === key) return '';

    loadingKey = key;
    try {
      var params = new URLSearchParams({ locationId: ctx.locationId, contactId: ctx.contactId });
      var res = await fetch(NEXUS_API + '/nexus/social-identity?' + params.toString(), {
        method: 'GET',
        credentials: 'omit'
      });
      var data = await res.json().catch(function() { return {}; });
      var url = data && data.success && data.identity ? data.identity.instagramProfileUrl : '';
      if (url) {
        cache[key] = { ts: Date.now(), url: url };
        return url;
      }
      cache[key] = { ts: Date.now(), url: '' };
      return '';
    } catch (_error) {
      return '';
    } finally {
      loadingKey = '';
    }
  }

  function looksLikeWhatsAppAction(el) {
    var text = visibleText(el).toLowerCase();
    var attrs = [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-testid'),
      el.getAttribute('href')
    ].filter(Boolean).join(' ').toLowerCase();
    return text.indexOf('whatsapp') !== -1 || attrs.indexOf('whatsapp') !== -1 || attrs.indexOf('wa.me') !== -1 || attrs.indexOf('api.whatsapp.com') !== -1;
  }

  function findWhatsAppButton() {
    var candidates = Array.prototype.slice.call(document.querySelectorAll('button,a,[role="button"]'));
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].id !== BUTTON_ID && looksLikeWhatsAppAction(candidates[i])) return candidates[i];
    }
    return null;
  }

  function createButton(url, floating) {
    var button = document.createElement('a');
    button.id = BUTTON_ID;
    button.href = url;
    button.target = '_blank';
    button.rel = 'noopener noreferrer';
    button.title = 'Abrir perfil Instagram';
    button.className = floating ? 'nexus-ig-floating' : '';
    button.innerHTML = IG_ICON + '<span>Instagram</span>';
    button.addEventListener('click', function() {
      showToast('Abrindo perfil do Instagram...');
    });
    return button;
  }

  function placeButton(url) {
    var existing = document.getElementById(BUTTON_ID);
    var whatsapp = findWhatsAppButton();

    if (existing) existing.href = url;

    if (whatsapp && whatsapp.parentElement) {
      if (existing && existing.parentElement === whatsapp.parentElement && !existing.classList.contains('nexus-ig-floating')) return;
      if (existing) existing.remove();
      var button = createButton(url, false);
      whatsapp.insertAdjacentElement('afterend', button);
      return;
    }

    if (!existing) {
      document.body.appendChild(createButton(url, true));
    } else {
      existing.className = 'nexus-ig-floating';
    }
  }

  async function upsertButton() {
    injectCSS();

    if (!isContactScreen()) {
      var existing = document.getElementById(BUTTON_ID);
      if (existing) existing.remove();
      return;
    }

    var ctx = getContext();
    var url = findInstagramInDom();
    if (!url) url = await fetchIdentity(ctx);

    if (!url) {
      var old = document.getElementById(BUTTON_ID);
      if (old) old.remove();
      return;
    }

    placeButton(url);
  }

  var lastUrl = window.location.href;
  var observer = new MutationObserver(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      var existing = document.getElementById(BUTTON_ID);
      if (existing) existing.remove();
    }
    clearTimeout(window.__nexusInstagramTimer);
    window.__nexusInstagramTimer = setTimeout(upsertButton, 350);
  });

  function start() {
    if (!document.body) return setTimeout(start, 500);
    injectCSS();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    upsertButton();
    setInterval(upsertButton, 1500);
  }

  start();
})();
