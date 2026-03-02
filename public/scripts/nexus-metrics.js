/**
 * Socialfy Nexus - Metrics Lab Inject v1.1.0
 * Injeta botão flutuante + overlay com iframe do Metrics Lab dentro do GHL.
 * Detecta locationId da URL e passa como parâmetro para factorai.mottivme.com.br.
 *
 * Fixes v1.1.0:
 *   LEAK-01 - keydown listener registrado apenas uma vez
 *   LEAK-03 - overflow restaurado ao navegar com overlay aberto
 *   BUG-02  - guard contra múltiplos setInterval de retry
 *   SEC-01  - iframe com sandbox restritivo
 *   SEC-02  - encodeURIComponent no locationId
 *   UX-04   - isReportingPage testa pathname E hash (GHL SPA)
 */
(function () {
  "use strict";

  var METRICS_URL = "https://factorai.mottivme.com.br/#/metrics-lab";
  var CHART_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';

  // Estado do módulo — evita duplicações entre chamadas de init()
  var _keydownBound = false;
  var _retryInterval = null;
  var _activeLocationUrl = null; // URL em uso pelo iframe (para "abrir em nova aba")

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function detectLocation() {
    var match = window.location.pathname.match(/\/location\/([^/]+)/);
    return match ? match[1] : null;
  }

  // FIX UX-04: GHL usa hash routing — testar pathname E hash
  function isReportingPage() {
    var full = window.location.pathname + window.location.hash;
    return /\/(reporting|ads|dashboard|analytics)/.test(full);
  }

  // FIX SEC-02: sempre encode o locationId antes de usar em URL
  function buildMetricsUrl(locationId) {
    return (
      METRICS_URL +
      (locationId ? "?location=" + encodeURIComponent(locationId) : "")
    );
  }

  // ─── CSS ────────────────────────────────────────────────────────────────────

  function injectCSS() {
    if (document.getElementById("nexus-metrics-css")) return;
    var style = document.createElement("style");
    style.id = "nexus-metrics-css";
    style.textContent = [
      "#nexus-metrics-overlay{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.65);",
      "display:none;align-items:flex-start;justify-content:center;backdrop-filter:blur(4px);}",
      "#nexus-metrics-overlay.open{display:flex;}",

      "#nexus-metrics-frame-wrapper{width:96vw;height:96vh;margin-top:2vh;background:#0f172a;",
      "border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.55);",
      "display:flex;flex-direction:column;}",

      "#nexus-metrics-header{display:flex;align-items:center;justify-content:space-between;",
      "padding:10px 16px;background:#1e293b;border-bottom:1px solid rgba(255,255,255,.08);min-height:44px;}",
      "#nexus-metrics-header-title{color:#f8fafc;font-size:14px;font-weight:600;",
      "display:flex;align-items:center;gap:8px;font-family:system-ui,sans-serif;}",
      "#nexus-metrics-header-title svg{stroke:#6366f1;}",
      "#nexus-metrics-header-actions{display:flex;align-items:center;gap:8px;}",

      "#nexus-metrics-open-new{background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);",
      "color:#a5b4fc;cursor:pointer;border-radius:6px;padding:4px 10px;font-size:12px;",
      "font-family:system-ui,sans-serif;font-weight:500;transition:background .15s;}",
      "#nexus-metrics-open-new:hover{background:rgba(99,102,241,.3);}",

      "#nexus-metrics-close{background:rgba(255,255,255,.08);border:none;color:#94a3b8;",
      "cursor:pointer;border-radius:6px;width:28px;height:28px;font-size:16px;",
      "display:flex;align-items:center;justify-content:center;transition:background .15s;}",
      "#nexus-metrics-close:hover{background:rgba(255,255,255,.18);color:#f8fafc;}",

      "#nexus-metrics-iframe{width:100%;flex:1;border:none;background:#0f172a;}",

      "#nexus-metrics-fab{position:fixed;bottom:148px;right:24px;z-index:99998;",
      "background:#6366f1;color:white;border:none;border-radius:50%;width:52px;height:52px;",
      "cursor:pointer;display:flex;align-items:center;justify-content:center;",
      "box-shadow:0 4px 16px rgba(99,102,241,.45);transition:transform .2s,box-shadow .2s;}",
      "#nexus-metrics-fab:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(99,102,241,.65);}",

      "#nexus-metrics-tab-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;",
      "background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.25);",
      "border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;",
      "font-family:system-ui,sans-serif;transition:all .15s;margin-left:8px;white-space:nowrap;}",
      "#nexus-metrics-tab-btn:hover{background:rgba(99,102,241,.2);border-color:#6366f1;}",
    ].join("");
    document.head.appendChild(style);
  }

  // ─── Overlay ─────────────────────────────────────────────────────────────────

  function buildOverlay() {
    if (document.getElementById("nexus-metrics-overlay")) return;

    var overlay = document.createElement("div");
    overlay.id = "nexus-metrics-overlay";

    var wrapper = document.createElement("div");
    wrapper.id = "nexus-metrics-frame-wrapper";

    var header = document.createElement("div");
    header.id = "nexus-metrics-header";

    var title = document.createElement("div");
    title.id = "nexus-metrics-header-title";
    // CHART_ICON é constante hardcoded — sem input externo, innerHTML seguro aqui
    title.innerHTML = CHART_ICON + "<span>Metrics Lab</span>";

    var actions = document.createElement("div");
    actions.id = "nexus-metrics-header-actions";

    var openNewBtn = document.createElement("button");
    openNewBtn.id = "nexus-metrics-open-new";
    openNewBtn.textContent = "↗ Abrir em nova aba";
    // FIX BUG-04: usa _activeLocationUrl capturado no momento de abertura do overlay
    openNewBtn.addEventListener("click", function () {
      window.open(_activeLocationUrl || METRICS_URL, "_blank");
    });

    var closeBtn = document.createElement("button");
    closeBtn.id = "nexus-metrics-close";
    closeBtn.innerHTML = "✕";
    closeBtn.title = "Fechar";
    closeBtn.addEventListener("click", closeOverlay);

    actions.appendChild(openNewBtn);
    actions.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(actions);

    // FIX SEC-01: sandbox restritivo — permite scripts/forms/popups mas bloqueia
    // top-frame navigation e acesso a window.opener
    var iframe = document.createElement("iframe");
    iframe.id = "nexus-metrics-iframe";
    iframe.src = "about:blank";
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
    );
    iframe.setAttribute("allow", "fullscreen");

    wrapper.appendChild(header);
    wrapper.appendChild(iframe);
    overlay.appendChild(wrapper);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay();
    });

    document.body.appendChild(overlay);

    // FIX LEAK-01: keydown listener registrado apenas uma vez em todo o lifecycle
    if (!_keydownBound) {
      _keydownBound = true;
      document.addEventListener("keydown", function (e) {
        var ov = document.getElementById("nexus-metrics-overlay");
        if (e.key === "Escape" && ov && ov.classList.contains("open")) {
          closeOverlay();
        }
      });
    }
  }

  function openOverlay() {
    var locationId = detectLocation();
    var targetUrl = buildMetricsUrl(locationId); // FIX SEC-02: encode aplicado dentro

    var overlay = document.getElementById("nexus-metrics-overlay");
    var iframe = document.getElementById("nexus-metrics-iframe");
    if (!overlay || !iframe) return;

    // Captura URL no momento de abertura — usada pelo botão "Abrir em nova aba"
    _activeLocationUrl = targetUrl;

    var currentSrc = iframe.getAttribute("data-loaded-src") || "";
    if (currentSrc !== targetUrl) {
      iframe.src = targetUrl;
      iframe.setAttribute("data-loaded-src", targetUrl);
    }

    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeOverlay() {
    var overlay = document.getElementById("nexus-metrics-overlay");
    if (overlay) overlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  // ─── Floating Action Button ──────────────────────────────────────────────────

  function buildFAB() {
    if (document.getElementById("nexus-metrics-fab")) return;
    var fab = document.createElement("button");
    fab.id = "nexus-metrics-fab";
    fab.title = "Metrics Lab";
    fab.innerHTML = CHART_ICON;
    fab.addEventListener("click", openOverlay);
    document.body.appendChild(fab);
  }

  // ─── Tab injection in reporting nav ─────────────────────────────────────────

  function tryInjectReportingTab() {
    if (document.getElementById("nexus-metrics-tab-btn")) return true;

    var candidates = [
      ".reporting-tabs",
      '[class*="reporting"] [class*="tabs"]',
      '[class*="report"] nav',
      '[role="tablist"]',
      ".hl-tabs",
      '[class*="tab-list"]',
      '[class*="sub-nav"]',
      '[class*="subnav"]',
    ];

    for (var i = 0; i < candidates.length; i++) {
      var target = document.querySelector(candidates[i]);
      if (target) {
        var btn = document.createElement("button");
        btn.id = "nexus-metrics-tab-btn";
        btn.innerHTML =
          CHART_ICON.replace('20" height="20"', '14" height="14"') +
          " Metrics Lab";
        btn.addEventListener("click", openOverlay);
        target.appendChild(btn);
        return true;
      }
    }
    return false;
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    var locationId = detectLocation();
    if (!locationId) return;

    injectCSS();
    buildOverlay();
    buildFAB();

    if (isReportingPage() && !tryInjectReportingTab()) {
      // FIX BUG-02: cancela retry anterior antes de criar novo
      if (_retryInterval) {
        clearInterval(_retryInterval);
        _retryInterval = null;
      }
      var attempts = 0;
      _retryInterval = setInterval(function () {
        attempts++;
        if (tryInjectReportingTab() || attempts >= 6) {
          clearInterval(_retryInterval);
          _retryInterval = null;
        }
      }, 700);
    }
  }

  // ─── SPA Navigation Watch ───────────────────────────────────────────────────

  var lastPath = window.location.pathname + window.location.hash;
  new MutationObserver(function () {
    var currentPath = window.location.pathname + window.location.hash;
    if (currentPath !== lastPath) {
      lastPath = currentPath;

      // FIX LEAK-03: se overlay estiver aberto ao navegar, fechar e restaurar overflow
      var overlay = document.getElementById("nexus-metrics-overlay");
      if (overlay && overlay.classList.contains("open")) {
        closeOverlay();
      }

      var tabBtn = document.getElementById("nexus-metrics-tab-btn");
      if (tabBtn) tabBtn.remove();

      var iframe = document.getElementById("nexus-metrics-iframe");
      if (iframe) iframe.removeAttribute("data-loaded-src");

      setTimeout(init, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  window.addEventListener("nexus:ready", init);

  // Fallback caso nexus-core não esteja carregado
  setTimeout(function () {
    if (!document.getElementById("nexus-metrics-fab")) init();
  }, 2500);
})();
