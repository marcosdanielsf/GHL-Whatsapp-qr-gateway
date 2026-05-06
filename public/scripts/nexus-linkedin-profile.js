/**
 * Socialfy Nexus - LinkedIn Profile Button v1.0.0
 * Injeta botao LinkedIn no GHL/Socialfy ao lado do botao WhatsApp/Instagram do contato.
 * Fallback API: /nexus/social-identity (le growth_leads.linkedin / linkedin_url / linkedin_profile_url).
 */
(function() {
  'use strict';

  var NEXUS_API = 'https://nexus.socialfy.me/api';
  var BUTTON_ID = 'nexus-linkedin-profile-button';
  var STYLE_ID = 'nexus-linkedin-profile-css';
  var TOAST_ID = 'nexus-linkedin-profile-toast';
  var CACHE_TTL_MS = 60 * 1000;
  var cache = {};
  var loadingKey = '';

  var LI_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.37V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45C23.2 24 24 23.23 24 22.28V1.72C24 .77 23.2 0 22.22 0Z"/></svg>';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#nexus-linkedin-profile-button{height:34px;min-width:34px;padding:0 10px;border:1px solid rgba(10,102,194,.32);border-radius:8px;background:rgba(10,102,194,.10);color:#0a66c2;display:inline-flex;align-items:center;justify-content:center;gap:6px;font:700 12px Inter,Arial,sans-serif;cursor:pointer;text-decoration:none;white-space:nowrap;transition:transform .15s,background .15s,color .15s,border-color .15s}',
      '#nexus-linkedin-profile-button:hover{transform:translateY(-1px);background:rgba(10,102,194,.18);border-color:rgba(10,102,194,.48);color:#004182;text-decoration:none}',
      '#nexus-linkedin-profile-button svg{width:16px;height:16px;fill:currentColor;flex:0 0 auto}',
      '#nexus-linkedin-profile-button.nexus-li-floating{position:fixed;right:24px;bottom:230px;z-index:99999;height:42px;border-radius:21px;box-shadow:0 8px 24px rgba(10,102,194,.18);background:#0a66c2;color:#fff;border:0}',
      '#nexus-linkedin-profile-toast{position:fixed;right:24px;bottom:282px;z-index:100001;max-width:300px;padding:10px 12px;border-radius:8px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);font:500 12px Inter,Arial,sans-serif;display:none}',
      '#nexus-linkedin-profile-toast.show{display:block}'
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

  var REJECTED = { pulse:1, posts:1, feed:1, learning:1, jobs:1, company:1, school:1, showcase:1, groups:1, events:1, newsletters:1, pub:1 };

  function normalizeVanity(raw) {
    if (!raw) return '';
    var value = String(raw).trim().replace(/^@+/, '');
    var urlMatch = value.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)/i);
    if (urlMatch) value = urlMatch[1];
    value = value.split(/[/?#\s]/)[0].replace(/^@+/, '').trim();
    if (!value) return '';
    if (REJECTED[value.toLowerCase()]) return '';
    return /^[a-zA-Z0-9\-_%]{3,100}$/.test(value) ? value : '';
  }

  function profileUrlFromText(raw) {
    if (!raw) return '';
    var text = String(raw);
    var urlMatch = text.match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s"'<>]+/i);
    var vanity = normalizeVanity(urlMatch ? urlMatch[0] : text);
    return vanity ? 'https://www.linkedin.com/in/' + vanity : '';
  }

  function visibleText(el) {
    return (el && el.innerText ? el.innerText : '').replace(/\s+/g, ' ').trim();
  }

  function findLinkedInInDom() {
    var labels = ['LinkedIn Profile URL', 'LinkedIn URL', 'LinkedIn Username', 'LinkedIn Vanity', 'LinkedIn', 'LI Profile URL', 'LI Username'];
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

    var links = document.querySelectorAll('a[href*="linkedin.com/in/"]');
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
      var url = data && data.success && data.identity ? data.identity.linkedinProfileUrl : '';
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

  function findInstagramButton() {
    return document.getElementById('nexus-instagram-profile-button')
      || document.getElementById('mottivme-instagram-profile-button');
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
    button.title = 'Abrir perfil LinkedIn';
    button.className = floating ? 'nexus-li-floating' : '';
    button.innerHTML = LI_ICON + '<span>LinkedIn</span>';
    button.addEventListener('click', function() {
      showToast('Abrindo perfil do LinkedIn...');
    });
    return button;
  }

  function placeButton(url) {
    var existing = document.getElementById(BUTTON_ID);
    var anchor = findInstagramButton() || findWhatsAppButton();

    if (existing) existing.href = url;

    if (anchor && anchor.parentElement) {
      if (existing && anchor.nextElementSibling === existing && !existing.classList.contains('nexus-li-floating')) return;
      if (existing) existing.remove();
      var button = createButton(url, false);
      anchor.insertAdjacentElement('afterend', button);
      return;
    }

    if (!existing) {
      document.body.appendChild(createButton(url, true));
    } else {
      existing.className = 'nexus-li-floating';
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
    var url = findLinkedInInDom();
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
    clearTimeout(window.__nexusLinkedinTimer);
    window.__nexusLinkedinTimer = setTimeout(upsertButton, 350);
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
