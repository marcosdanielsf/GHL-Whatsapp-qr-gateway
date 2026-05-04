/**
 * Socialfy Nexus - Audio Recorder v1.0.0
 * Botao de audio proprio para enviar WhatsApp pelo Nexus dentro do GHL.
 */
(function() {
  'use strict';

  var NEXUS_API = 'https://nexus.socialfy.me/api';
  var BUTTON_ID = 'nexus-audio-recorder';
  var TOAST_ID = 'nexus-audio-toast';
  var STYLE_ID = 'nexus-audio-css';

  var mediaRecorder = null;
  var mediaStream = null;
  var chunks = [];
  var startedAt = 0;
  var timer = null;
  var currentMimeType = '';
  var MIN_RECORDING_MS = 700;
  var MIN_AUDIO_BYTES = 1024;

  var MIC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';
  var STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8H8z"/></svg>';

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#nexus-audio-recorder{position:fixed;right:24px;bottom:88px;z-index:99999;height:42px;min-width:42px;padding:0 12px;border:0;border-radius:21px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(17,24,39,.22);display:flex;align-items:center;gap:8px;font:600 13px Inter,Arial,sans-serif;cursor:pointer;transition:transform .15s,background .15s,opacity .15s}',
      '#nexus-audio-recorder:hover{transform:translateY(-1px)}',
      '#nexus-audio-recorder svg{width:18px;height:18px;fill:currentColor;flex:0 0 auto}',
      '#nexus-audio-recorder[disabled]{opacity:.6;cursor:not-allowed}',
      '#nexus-audio-recorder.recording{background:#dc2626}',
      '#nexus-audio-recorder.sending{background:#2563eb}',
      '#nexus-audio-toast{position:fixed;right:24px;bottom:140px;z-index:100000;max-width:280px;padding:10px 12px;border-radius:8px;background:#111827;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);font:500 12px Inter,Arial,sans-serif;display:none}',
      '#nexus-audio-toast.show{display:block}',
      '#nexus-audio-toast.error{background:#991b1b}',
      '#nexus-audio-toast.ok{background:#166534}'
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

  function pickMimeType() {
    var options = [
      'audio/ogg;codecs=opus',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4'
    ];

    for (var i = 0; i < options.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(options[i])) {
        return options[i];
      }
    }
    return '';
  }

  function extensionForMime(mime) {
    if (mime.indexOf('ogg') >= 0) return 'ogg';
    if (mime.indexOf('mp4') >= 0) return 'm4a';
    return 'webm';
  }

  function setButtonState(state) {
    var button = document.getElementById(BUTTON_ID);
    if (!button) return;

    button.className = state || '';
    button.disabled = state === 'sending';

    if (state === 'recording') {
      button.innerHTML = STOP_ICON + '<span id="nexus-audio-label">0:00</span>';
    } else if (state === 'sending') {
      button.innerHTML = MIC_ICON + '<span>Enviando...</span>';
    } else {
      button.innerHTML = MIC_ICON + '<span>Audio Nexus</span>';
    }
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(function() {
      var label = document.getElementById('nexus-audio-label');
      if (!label) return;
      var seconds = Math.floor((Date.now() - startedAt) / 1000);
      var mm = Math.floor(seconds / 60);
      var ss = String(seconds % 60).padStart(2, '0');
      label.textContent = mm + ':' + ss;
    }, 250);
  }

  function stopTracks() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(function(track) { track.stop(); });
      mediaStream = null;
    }
  }

  async function startRecording() {
    var ctx = getContext();
    if (!ctx.locationId || !ctx.contactId) {
      showToast('Abra um contato do GHL para gravar audio.', 'error');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      showToast('Gravacao de audio nao suportada neste navegador.', 'error');
      return;
    }

    try {
      currentMimeType = pickMimeType();
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      chunks = [];
      mediaRecorder = currentMimeType
        ? new MediaRecorder(mediaStream, { mimeType: currentMimeType })
        : new MediaRecorder(mediaStream);
      currentMimeType = mediaRecorder.mimeType || currentMimeType;

      mediaRecorder.ondataavailable = function(event) {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      mediaRecorder.onstop = sendRecording;

      startedAt = Date.now();
      mediaRecorder.start(250);
      setButtonState('recording');
      startTimer();
    } catch (error) {
      stopTracks();
      showToast(error && error.message ? error.message : 'Microfone indisponivel.', 'error');
      setButtonState('');
    }
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    if (Date.now() - startedAt < MIN_RECORDING_MS) {
      showToast('Segure um pouco mais antes de enviar.', 'error');
      return;
    }
    clearInterval(timer);
    try {
      if (mediaRecorder.requestData) mediaRecorder.requestData();
    } catch (error) {}
    mediaRecorder.stop();
    setButtonState('sending');
  }

  async function sendRecording() {
    var ctx = getContext();
    var mime = currentMimeType || (chunks[0] && chunks[0].type) || 'audio/webm';
    var blob = new Blob(chunks, { type: mime });

    if (!blob.size || blob.size < MIN_AUDIO_BYTES) {
      stopTracks();
      showToast('Audio muito curto. Grave de novo.', 'error');
      setButtonState('');
      return;
    }

    try {
      var form = new FormData();
      form.append('locationId', ctx.locationId);
      form.append('contactId', ctx.contactId);
      form.append('ptt', '1');
      form.append('audio', blob, 'nexus-audio.' + extensionForMime(mime));

      var res = await fetch(NEXUS_API + '/nexus/audio/send', {
        method: 'POST',
        body: form
      });
      var data = await res.json().catch(function() { return {}; });

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha ao enviar audio.');
      }

      showToast('Audio enviado pelo Nexus.', 'ok');
    } catch (error) {
      showToast(error && error.message ? error.message : 'Erro ao enviar audio.', 'error');
    } finally {
      chunks = [];
      mediaRecorder = null;
      stopTracks();
      setButtonState('');
    }
  }

  function createButton() {
    injectCSS();
    var button = document.getElementById(BUTTON_ID);

    if (!isContactScreen()) {
      if (button) button.style.display = 'none';
      return;
    }

    if (!button) {
      button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.title = 'Gravar audio pelo Socialfy Nexus';
      button.addEventListener('click', function() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          stopRecording();
        } else {
          startRecording();
        }
      });
      document.body.appendChild(button);
    }

    button.style.display = 'flex';
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      setButtonState('');
    }
  }

  function init() {
    createButton();
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
