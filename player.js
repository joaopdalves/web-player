let tracks = [];
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let isMuted = false;
let isSeeking = false;
let pendingFile = null;
let spotifyToken = null;
let tokenExpiry = 0;
let _batchQueue = [];
let queue = [];
let _preQueueIndex = -1;
let ctxTargetIndex = -1;
let _confirmCallback = null;
let toastTimer;
let searchQuery = '';
let db = null;
window._editDataTrackIndex = -1;
const ITEM_H = 62;
let vScrollTop = 0;
let vContainerH = 0;
let vTotalItems = 0;
let vFilteredCache = [];
let _shufflePool = [];
const _pwStore = (() => {
  let _v = null;
  return {
    set(v) {
      _v = v;
    },
    get() {
      return _v;
    },
    clear() {
      _v = null;
    }
  };
})();
let lfmSessionKey = null;
let lfmApiKey = null;
let lfmApiSecret = null;
let lfmUsername = null;
let lfmPendingToken = null;
let scrobbleTimer = null;
let nowPlayingTrack = null;
let scrobbled = false;
let scrobbleThreshold = 0;
let organicListenTime = 0;
let lastTimeUpdatePos = null;
let dragSrcIndex = -1;
let _dragActive = false;
let _dragPending = false;
let _dragEl = null;
let _dragStartX = 0;
let _dragStartY = 0;
let _dragPendingIndex = -1;
let _dragLeftItem = false;
const DRAG_THRESHOLD = 5;
const audio = document.getElementById('audio-el');
function _hasEncryptedCreds() {
  return ['sp_cid', 'sp_cs', 'lfm_key', 'lfm_secret', 'lfm_session', 'lfm_user', '_sentinel'].some(k => !!localStorage.getItem('enc_' + k));
}
function _getFirstEncryptedKey() {
  const found = ['sp_cid', 'sp_cs', 'lfm_key', 'lfm_secret', 'lfm_session', 'lfm_user', '_sentinel'].find(k => !!localStorage.getItem('enc_' + k));
  return found ? 'enc_' + found : null;
}
async function _deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    salt,
    iterations: 600000,
    hash: 'SHA-256'
  }, keyMaterial, {
    name: 'AES-GCM',
    length: 256
  }, false, ['encrypt', 'decrypt']);
}
async function saveSecret(storageKey, value) {
  const pw = _pwStore.get();
  if (!pw) throw new Error('Sem senha master ativa');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _deriveKey(pw, salt);
  const enc = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv
  }, key, new TextEncoder().encode(value));
  localStorage.setItem('enc_' + storageKey, JSON.stringify({
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(enc))
  }));
}
async function loadSecret(storageKey) {
  const pw = _pwStore.get();
  if (!pw) return null;
  const raw = localStorage.getItem('enc_' + storageKey);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw);
    const key = await _deriveKey(pw, new Uint8Array(stored.salt));
    const dec = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: new Uint8Array(stored.iv)
    }, key, new Uint8Array(stored.data));
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}
function removeSecret(storageKey) {
  localStorage.removeItem('enc_' + storageKey);
}
let _masterResolve = null;
let _masterAttempts = parseInt(localStorage.getItem('_masterAttempts') || '0', 10);
let _masterLockedUntil = parseInt(localStorage.getItem('_masterLockedUntil') || '0', 10);
const _masterPlaceholders = {
  'master-input': 'Digite uma senha',
  'master-confirm': 'Repita a senha'
};
const _modalUrlPlaceholder = 'https://open.spotify.com/track/...';
const _animatedTrackIds = new Set();
let _pendingNewTrackId = null;
let _appReadyForTrackAnim = false;
let _trackRemoveLock = false;
function _modalUrlErr(msg) {
  const input = document.getElementById('modal-spotify-url');
  input.value = '';
  input.placeholder = msg;
  input.classList.add('input-error');
  input.focus();
}
function _modalUrlErrClear() {
  const input = document.getElementById('modal-spotify-url');
  input.classList.remove('input-error');
  input.placeholder = _modalUrlPlaceholder;
}
function _masterErr(msg, targetId = 'master-input', centered = false) {
  const input = document.getElementById(targetId);
  input.value = '';
  input.placeholder = msg;
  input.classList.add('input-error');
  if (centered) input.classList.add('input-error-centered');
  input.focus();
}
function _masterErrClear() {
  ['master-input', 'master-confirm'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('input-error', 'input-error-centered');
    el.placeholder = _masterPlaceholders[id];
  });
}
function masterPrompt() {
  return new Promise(resolve => {
    _masterResolve = resolve;
    const hasData = _hasEncryptedCreds();
    document.getElementById('master-title').textContent = hasData ? 'Digite sua senha' : 'Criar senha';
    document.getElementById('master-sub').textContent = hasData ? 'Digite a senha para descriptografar suas credenciais salvas.' : 'Esta senha criptografa suas credenciais localmente. Não é possível recuperá-la.';
    document.getElementById('master-label').textContent = hasData ? 'Senha' : 'Nova senha';
    document.getElementById('master-confirm-group').style.display = hasData ? 'none' : '';
    document.getElementById('master-btn').textContent = hasData ? 'Entrar' : 'Criar';
    _masterErrClear();
    document.getElementById('master-input').value = '';
    document.getElementById('master-confirm').value = '';
    if (hasData && _masterAttempts >= 3) {
      document.getElementById('master-input').disabled = true;
      const btn = document.getElementById('master-btn');
      btn.textContent = 'Apagar dados e recomeçar';
      btn.disabled = false;
      btn.style.background = 'none';
      btn.style.border = '1px solid rgba(255,80,80,0.35)';
      btn.style.color = '#e05555';
      btn.style.boxShadow = 'none';
      btn.style.textShadow = 'none';
      btn.onclick = masterReset;
      _masterErr('Você esgotou as suas tentativas.', 'master-input', true);
    } else {
      document.getElementById('master-input').disabled = false;
      const btn = document.getElementById('master-btn');
      btn.disabled = false;
      btn.style.cssText = '';
      btn.className = 'btn-primary';
      btn.onclick = masterConfirm;
      setTimeout(() => document.getElementById('master-input').focus(), 100);
    }
  });
}
async function masterConfirm() {
  const pw = document.getElementById('master-input').value;
  const pw2 = document.getElementById('master-confirm').value;
  const btn = document.getElementById('master-btn');
  const hasData = _hasEncryptedCreds();
  if (hasData) {
    const now = Date.now();
    if (_masterLockedUntil > now) {
      const secs = Math.ceil((_masterLockedUntil - now) / 1000);
      _masterErr(`Aguarde ${secs}s antes de tentar novamente.`, 'master-input', true);
      return;
    }
  }
  if (!pw) {
    _masterErr('Digite uma senha.');
    return;
  }
  if (!hasData) {
    if (pw.length < 6) {
      _masterErr('Mínimo 6 caracteres.');
      return;
    }
    if (pw !== pw2) {
      _masterErr('As senhas não conferem.', 'master-confirm');
      return;
    }
  }
  btn.textContent = '...';
  btn.disabled = true;
  if (hasData) {
    try {
      const firstKey = _getFirstEncryptedKey();
      const raw = JSON.parse(localStorage.getItem(firstKey));
      const testKey = await _deriveKey(pw, new Uint8Array(raw.salt));
      await crypto.subtle.decrypt({
        name: 'AES-GCM',
        iv: new Uint8Array(raw.iv)
      }, testKey, new Uint8Array(raw.data));
      _masterAttempts = 0;
      _masterLockedUntil = 0;
      localStorage.removeItem('_masterAttempts');
      localStorage.removeItem('_masterLockedUntil');
    } catch {
      _masterAttempts++;
      const delays = [0, 5000, 15000];
      _masterLockedUntil = Date.now() + (delays[_masterAttempts - 1] || 30000);
      localStorage.setItem('_masterAttempts', String(_masterAttempts));
      localStorage.setItem('_masterLockedUntil', String(_masterLockedUntil));
      const restantes = 3 - _masterAttempts;
      if (_masterAttempts >= 3) {
        _masterErr('Você esgotou as suas tentativas.', 'master-input', true);
        document.getElementById('master-input').disabled = true;
        btn.textContent = 'Apagar dados e recomeçar';
        btn.disabled = false;
        btn.style.background = 'none';
        btn.style.border = '1px solid rgba(255,80,80,0.35)';
        btn.style.color = '#e05555';
        btn.style.boxShadow = 'none';
        btn.style.textShadow = 'none';
        btn.onclick = masterReset;
      } else {
        const waitSec = Math.ceil((delays[_masterAttempts - 1] || 0) / 1000);
        _masterErr(`Senha incorreta. ${restantes} tentativa${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''}.`, 'master-input', true);
        btn.textContent = 'Entrar';
        btn.disabled = false;
      }
      return;
    }
  }
  _pwStore.set(pw);
  if (!hasData) {
    saveSecret('_sentinel', '1').catch(() => {});
  }
  document.getElementById('master-overlay').classList.add('hidden');
  const appEl = document.getElementById('app');
  appEl.style.visibility = 'visible';
  requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.add('app-visible')));
  document.getElementById('settings-wrap').style.visibility = 'visible';
  btn.textContent = hasData ? 'Entrar' : 'Criar';
  btn.disabled = false;
  if (_masterResolve) {
    _masterResolve(pw);
    _masterResolve = null;
  }
}
function masterReset() {
  document.getElementById('reset-confirm-popup').classList.add('visible');
}
function resetPopupClose() {
  document.getElementById('reset-confirm-popup').classList.remove('visible');
}
function masterResetConfirmed() {
  resetPopupClose();
  localStorage.clear();
  _masterAttempts = 0;
  _masterLockedUntil = 0;
  _pwStore.clear();
  (function _deleteDB() {
    try {
      const openReq = indexedDB.open('player_db');
      openReq.onsuccess = function (e) {
        const d = e.target.result;
        d.close();
        db = null;
        indexedDB.deleteDatabase('player_db');
      };
      openReq.onerror = function () {
        indexedDB.deleteDatabase('player_db');
      };
    } catch (e) {}
  })();
  tracks = [];
  currentIndex = -1;
  isPlaying = false;
  lfmSessionKey = null;
  lfmApiKey = null;
  lfmApiSecret = null;
  queue = [];
  _shufflePool = [];
  document.getElementById('master-input').disabled = false;
  _masterErrClear();
  const btn = document.getElementById('master-btn');
  btn.style.cssText = '';
  btn.className = 'btn-primary';
  btn.onclick = masterConfirm;
  document.getElementById('master-title').textContent = 'Criar senha';
  document.getElementById('master-sub').textContent = 'Esta senha criptografa suas credenciais localmente. Não é possível recuperá-la.';
  document.getElementById('master-label').textContent = 'Nova senha';
  document.getElementById('master-confirm-group').style.display = '';
  btn.textContent = 'Criar';
  document.getElementById('master-input').value = '';
  document.getElementById('master-confirm').value = '';
  setTimeout(() => document.getElementById('master-input').focus(), 100);
}
async function init() {
  await masterPrompt();
  const setupDone = localStorage.getItem('_setup_done');
  if (!setupDone) {
    localStorage.setItem('_setup_done', '1');
    document.getElementById('setup-overlay').style.visibility = 'visible';
  } else {
    document.getElementById('setup-overlay').style.visibility = 'visible';
    document.getElementById('setup-overlay').classList.add('hidden');
  }
  await loadTracks();
  await _loadPlaylistData();
  setupVirtualScroll();
  setupAudioListeners();
  setupProgressListeners();
  lfmInit();
  const appEl = document.getElementById('app');
  const doRender = () => {
    _animatedTrackIds.clear();
    _appReadyForTrackAnim = false;
    renderList();
  };
  if (appEl.classList.contains('app-visible')) {
    doRender();
  } else {
    appEl.addEventListener('transitionend', doRender, {
      once: true
    });
  }
}
function switchTab(tab) {
  ['spotify', 'lastfm'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    const panel = document.getElementById('panel-' + t);
    if (t === tab) {
      panel.classList.add('active');
      panel.style.animation = 'none';
      panel.offsetHeight;
      panel.style.animation = '';
    } else {
      panel.classList.remove('active');
    }
  });
}
function openSetupOverlay(tab) {
  const overlay = document.getElementById('setup-overlay');
  overlay.style.visibility = 'visible';
  overlay.classList.remove('hidden');
  switchTab(tab || 'spotify');
  document.getElementById('settings-panel').classList.add('hidden');
  (async () => {
    const cid = await loadSecret('sp_cid');
    const cs = await loadSecret('sp_cs');
    if (cid) {
      const el = document.getElementById('setup-client-id');
      if (el) el.value = cid;
    }
    if (cs) {
      const el = document.getElementById('setup-client-secret');
      if (el) el.value = cs;
    }
  })();
}
function _showSetupWarn(tooltipId, textId, msg) {
  const tip = document.getElementById(tooltipId);
  const txt = document.getElementById(textId);
  if (txt) txt.textContent = msg;
  if (tip) {
    tip.classList.remove('hidden');
    tip.classList.add('visible');
    clearTimeout(tip._hideTimer);
    tip._hideTimer = setTimeout(() => {
      tip.classList.remove('visible');
      setTimeout(() => tip.classList.add('hidden'), 250);
    }, 3500);
  }
}
function saveSpotifyCredentials() {
  const cid = document.getElementById('setup-client-id').value.trim();
  const cs = document.getElementById('setup-client-secret').value.trim();
  if (!cid || !cs) {
    _showSetupWarn('sp-warn-tooltip', 'sp-warn-text', 'Preencha o Client ID e o Client Secret.');
    return;
  }
  (async () => {
    try {
      await saveSecret('sp_cid', cid);
      await saveSecret('sp_cs', cs);
      toast('Credenciais do Spotify salvas!');
      switchTab('lastfm');
    } catch (e) {
      _showSetupWarn('sp-warn-tooltip', 'sp-warn-text', 'Erro ao salvar — tente novamente.');
    }
  })();
}
function skipSpotifyCredentials() {
  switchTab('lastfm');
}
function saveCredentials() {
  const lfmKey = document.getElementById('lfm-api-key').value.trim();
  const lfmSec = document.getElementById('lfm-api-secret').value.trim();
  (async () => {
    try {
      if (lfmKey) await saveSecret('lfm_key', lfmKey);
      if (lfmSec) await saveSecret('lfm_secret', lfmSec);
      document.getElementById('setup-overlay').classList.add('hidden');
      lfmInit();
      toast('Configurações salvas!');
    } catch (e) {
      toast('Erro ao salvar configurações — tente novamente.');
    }
  })();
}
async function _fetchWithTimeout(url, options, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
async function _fetchRace(urls, options, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = urls.length;
    const errors = [];
    for (const url of urls) {
      _fetchWithTimeout(url, options, timeoutMs).then(res => {
        if (!settled && res.ok) {
          settled = true;
          resolve(res);
        } else {
          errors.push(url + ': HTTP ' + res.status);
          if (!settled && --pending === 0) reject(new Error(errors.join(' | ')));else pending--;
        }
      }).catch(e => {
        errors.push(url + ': ' + (e.name === 'AbortError' ? 'timeout' : e.message));
        if (!settled && --pending === 0) reject(new Error(errors.join(' | ')));
      });
    }
  });
}
async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken;
  const cid = await loadSecret('sp_cid');
  const cs = await loadSecret('sp_cs');
  if (!cid || !cs) throw new Error('Credenciais do Spotify não configuradas. Abra as Configurações e salve seu Client ID e Client Secret.');
  const tokenUrl = 'https://accounts.spotify.com/api/token';
  const body = 'grant_type=client_credentials';
  const auth = 'Basic ' + btoa(cid + ':' + cs);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': auth
  };
  let data = null;
  try {
    const r = await _fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers,
      body
    }, 3000);
    if (r.ok) {
      const j = await r.json();
      if (j.access_token) data = j;
    }
  } catch (e) {}
  if (!data) {
    const proxies = ['https://corsproxy.io/?' + encodeURIComponent(tokenUrl), 'https://api.allorigins.win/raw?url=' + encodeURIComponent(tokenUrl), 'https://proxy.cors.sh/' + tokenUrl, 'https://cors-anywhere.herokuapp.com/' + tokenUrl];
    let res;
    try {
      res = await _fetchRace(proxies, {
        method: 'POST',
        headers,
        body
      }, 8000);
    } catch (e) {
      throw new Error('Não foi possível conectar ao Spotify. Verifique sua conexão e as credenciais. (' + e.message + ')');
    }
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Resposta inválida do Spotify — tente novamente.');
    }
  }
  if (!data?.access_token) {
    const detail = data?.error_description || data?.error || JSON.stringify(data);
    throw new Error('Spotify recusou as credenciais: ' + detail + '. Verifique Client ID e Client Secret.');
  }
  spotifyToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}
function extractTrackId(url) {
  const m = url.match(/track[/:]([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
async function fetchSpotifyMeta(url) {
  const id = extractTrackId(url);
  if (!id) throw new Error('Link inválido. Use um link do tipo open.spotify.com/track/...');
  const token = await getSpotifyToken();
  const apiUrl = `https://api.spotify.com/v1/tracks/${id}`;
  const headers = {
    'Authorization': 'Bearer ' + token
  };
  let d = null;
  try {
    const r = await _fetchWithTimeout(apiUrl, {
      headers
    }, 3000);
    if (r.ok) {
      const j = await r.json();
      if (j.name) d = j;
    }
  } catch (e) {}
  if (!d) {
    const proxies = ['https://corsproxy.io/?' + encodeURIComponent(apiUrl), 'https://api.allorigins.win/raw?url=' + encodeURIComponent(apiUrl), 'https://proxy.cors.sh/' + apiUrl, 'https://cors-anywhere.herokuapp.com/' + apiUrl];
    let res;
    try {
      res = await _fetchRace(proxies, {
        headers
      }, 8000);
    } catch (e) {
      throw new Error('Erro ao buscar a música. Verifique sua conexão. (' + e.message + ')');
    }
    try {
      d = await res.json();
    } catch (e) {
      throw new Error('Resposta inválida da API do Spotify.');
    }
  }
  if (!d?.name) {
    if (d?.error?.status === 401) throw new Error('Token inválido — recarregue a página e tente novamente.');
    if (d?.error?.status === 404) throw new Error('Música não encontrada. Confirme o link do Spotify.');
    const detail = d?.error ? JSON.stringify(d.error) : '';
    throw new Error('Música não encontrada. Verifique o link.' + (detail ? ' (' + detail + ')' : ''));
  }
  const coverUrl = d.album?.images?.[1]?.url || d.album?.images?.[0]?.url || null;
  let coverBase64 = null;
  if (coverUrl) {
    const coverProxies = [coverUrl, 'https://corsproxy.io/?' + encodeURIComponent(coverUrl), 'https://api.allorigins.win/raw?url=' + encodeURIComponent(coverUrl)];
    for (const cp of coverProxies) {
      try {
        const r = await _fetchWithTimeout(cp, {}, 6000);
        if (!r.ok) continue;
        const blob = await r.blob();
        if (!blob.size) continue;
        coverBase64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = rej;
          reader.readAsDataURL(blob);
        });
        if (coverBase64) break;
      } catch (e) {
        continue;
      }
    }
  }
  return {
    name: d.name,
    artist: d.artists.map(a => a.name).join(', '),
    cover: coverBase64 || coverUrl || null,
    spotifyUrl: url,
    albumId: d.album?.id || null,
    albumName: d.album?.name || null,
    albumArtists: d.album?.artists?.map(a => a.name) || null
  };
}
function triggerAddTrack() {
  document.getElementById('file-picker-overlay').classList.remove('hidden');
}
function fpClose() {
  const overlay = document.getElementById('file-picker-overlay');
  if (overlay.classList.contains('hidden') || overlay.classList.contains('modal--closing')) return;
  document.getElementById('fp-drop-zone').classList.remove('dragover');
  overlay.classList.add('modal--closing');
  setTimeout(() => {
    overlay.classList.remove('modal--closing');
    overlay.classList.add('hidden');
  }, 180);
}
function fpCloseImmediate() {
  const overlay = document.getElementById('file-picker-overlay');
  overlay.classList.remove('modal--closing');
  overlay.classList.add('hidden');
  document.getElementById('fp-drop-zone').classList.remove('dragover');
}
function fpBrowse() {
  const input = document.getElementById('file-input');
  const doRestore = () => {
    if (window._restoreCursor) window._restoreCursor();
  };
  window.addEventListener('focus', doRestore, {
    once: true
  });
  window.addEventListener('mousemove', doRestore, {
    once: true
  });
  input.click();
}
function fpDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('fp-drop-zone').classList.add('dragover');
}
function fpDragLeave(e) {
  e.stopPropagation();
  document.getElementById('fp-drop-zone').classList.remove('dragover');
}
function fpDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('fp-drop-zone').classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|aiff)$/i.test(f.name));
  if (!files.length) {
    toast('Nenhum arquivo de áudio encontrado.');
    return;
  }
  fpCloseImmediate();
  if (files.length === 1) {
    pendingFile = files[0];
    document.getElementById('modal-spotify-url').value = '';
    _modalUrlErrClear();
    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-spotify-url').focus(), 100);
  } else {
    addTracksInBatch(files);
  }
}
function onFileSelected(e) {
  const files = Array.from(e.target.files);
  e.target.value = '';
  if (!files.length) return;
  fpCloseImmediate();
  if (files.length === 1) {
    pendingFile = files[0];
    document.getElementById('modal-spotify-url').value = '';
    _modalUrlErrClear();
    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-spotify-url').focus(), 100);
  } else {
    addTracksInBatch(files);
  }
}
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('modal--closing');
  const _doHide = () => {
    overlay.classList.remove('modal--closing');
    overlay.classList.add('hidden');
    pendingFile = null;
    window._editDataTrackIndex = -1;
    const title = document.getElementById('modal-title');
    const hint = document.getElementById('modal-hint');
    const noDataBtn = document.getElementById('btn-no-data');
    if (title) title.textContent = 'Adicionar música';
    if (hint) hint.textContent = 'Cole o link da música no Spotify para buscar automaticamente a capa, nome e artista. Obrigatório para adicionar com dados.';
    if (noDataBtn) noDataBtn.style.display = '';
    if (_batchQueue.length > 0) {
      setTimeout(() => _batchProcessNext(), 300);
    }
  };
  const card = overlay.querySelector('.modal-card');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    _doHide();
  };
  if (card) {
    card.addEventListener('animationend', finish, {
      once: true
    });
  } else {
    overlay.addEventListener('animationend', finish, {
      once: true
    });
  }
  setTimeout(finish, 280);
}
async function confirmAdd() {
  const url = document.getElementById('modal-spotify-url').value.trim();
  const btn = document.getElementById('btn-confirm');
  const editIdx = window._editDataTrackIndex >= 0 ? window._editDataTrackIndex : -1;
  if (!url) {
    _modalUrlErr('Link obrigatório — use "Sem dados" para pular');
    return;
  }
  if (!url.includes('spotify.com') || !url.includes('/track/')) {
    _modalUrlErr('Link inválido: use open.spotify.com/track/...');
    return;
  }
  _modalUrlErrClear();
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  try {
    const meta = await fetchSpotifyMeta(url);
    if (editIdx >= 0 && tracks[editIdx]) {
      const t = tracks[editIdx];
      t.name = meta.name;
      t.artist = meta.artist;
      t.cover = meta.cover;
      t.spotifyUrl = meta.spotifyUrl || null;
      t.albumId = meta.albumId || null;
      t.albumName = meta.albumName || null;
      t.albumArtists = meta.albumArtists || null;
      t.noData = false;
      if (t.coverUrl && t.coverUrl.startsWith('blob:')) URL.revokeObjectURL(t.coverUrl);
      if (meta.cover && meta.cover.startsWith('data:')) {
        const mime = meta.cover.split(';')[0].split(':')[1] || 'image/jpeg';
        t.coverUrl = _base64ToBlobURL(meta.cover, mime);
      } else if (meta.cover && (meta.cover.startsWith('http') || meta.cover.startsWith('//'))) {
        t.coverUrl = meta.cover;
      } else {
        t.coverUrl = null;
      }
      saveTrack(t);
      if (currentIndex === editIdx) selectTrack(editIdx);else renderList();
      toast(`Dados de "${meta.name}" atualizados!`);
    } else {
      addTrackLocal(meta);
    }
    setTimeout(() => closeModal(), 600);
  } catch (err) {
    _modalUrlErr('Erro: ' + err.message);
  } finally {
    btn.innerHTML = 'Buscar e adicionar';
    btn.disabled = false;
  }
}
function insertAlphabetically(track) {
  const name = track.name.toLowerCase();
  let insertAt = tracks.length;
  for (let i = 0; i < tracks.length; i++) {
    if (name < tracks[i].name.toLowerCase()) {
      insertAt = i;
      break;
    }
  }
  const currentId = currentIndex >= 0 ? tracks[currentIndex]?.id : null;
  tracks.splice(insertAt, 0, track);
  if (currentId) currentIndex = tracks.findIndex(t => t.id === currentId);
  tracks.forEach((t, idx) => {
    t.order = idx;
    saveTrack(t);
  });
}
function addTrackLocal(meta) {
  if (!pendingFile) return;
  const id = 'track_' + Date.now();
  const reader = new FileReader();
  reader.onload = function (e) {
    const track = {
      id,
      name: meta.name,
      artist: meta.artist,
      cover: meta.cover,
      spotifyUrl: meta.spotifyUrl || null,
      albumId: meta.albumId || null,
      albumName: meta.albumName || null,
      albumArtists: meta.albumArtists || null,
      noData: meta.noData || false,
      fileData: e.target.result,
      fileName: pendingFile.name,
      order: Date.now()
    };
    track.blobUrl = _base64ToBlobURL(track.fileData, 'audio/mpeg');
    if (track.cover && track.cover.startsWith('data:')) {
      const mime = track.cover.split(';')[0].split(':')[1] || 'image/jpeg';
      track.coverUrl = _base64ToBlobURL(track.cover, mime);
    } else if (track.cover && (track.cover.startsWith('http') || track.cover.startsWith('//'))) {
      track.coverUrl = track.cover;
    } else {
      track.coverUrl = null;
    }
    insertAlphabetically(track);
    _shufflePool = [];
    _pendingNewTrackId = track.id;
    renderList();
    toast(`"${meta.name}" adicionada!`);
    if (tracks.length === 1) selectTrack(0);
  };
  reader.readAsDataURL(pendingFile);
}
function confirmAddNoData() {
  if (!pendingFile) return;
  const file = pendingFile;
  const name = file.name.replace(/\.[^.]+$/, '');
  closeModal();
  const id = 'track_' + Date.now();
  const reader = new FileReader();
  reader.onload = function (ev) {
    const track = {
      id,
      name: name,
      artist: 'Artista desconhecido',
      cover: null,
      spotifyUrl: null,
      noData: true,
      fileData: ev.target.result,
      fileName: file.name,
      order: Date.now()
    };
    track.blobUrl = _base64ToBlobURL(track.fileData, 'audio/mpeg');
    track.coverUrl = null;
    insertAlphabetically(track);
    _shufflePool = [];
    _pendingNewTrackId = track.id;
    renderList();
    toast('"' + name + '" adicionada!');
    if (tracks.length === 1) selectTrack(0);
  };
  reader.readAsDataURL(file);
}
function addTracksInBatch(files) {
  const limited = files.slice(0, 10);
  if (files.length > 10) toast('Atenção: apenas as primeiras 10 músicas serão processadas.');
  _batchQueue = limited.slice();
  _batchProcessNext();
}
function _batchProcessNext() {
  if (!_batchQueue.length) return;
  const file = _batchQueue.shift();
  pendingFile = file;
  document.getElementById('modal-spotify-url').value = '';
  _modalUrlErrClear();
  const remaining = _batchQueue.length;
  const title = document.getElementById('modal-title');
  const hint = document.getElementById('modal-hint');
  if (title) title.textContent = remaining > 0 ? `Adicionar música (faltam ${remaining + 1})` : 'Adicionar música';
  if (hint) hint.textContent = `Arquivo: ${file.name.replace(/\.[^.]+$/, '')} — cole o link do Spotify ou clique em "Buscar e adicionar" para pular.`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-spotify-url').focus(), 100);
}
function dbOpen() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }
    const req = indexedDB.open('player_db', 2);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tracks')) {
        d.createObjectStore('tracks', {
          keyPath: 'id'
        });
      }
      if (!d.objectStoreNames.contains('playlists')) {
        d.createObjectStore('playlists', {
          keyPath: 'id'
        });
      }
      if (!d.objectStoreNames.contains('playlistTracks')) {
        const pts = d.createObjectStore('playlistTracks', {
          keyPath: 'id'
        });
        pts.createIndex('byPlaylist', 'playlistId');
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      db.onclose = () => {
        db = null;
      };
      resolve(db);
    };
    req.onerror = e => reject(e.target.error);
  });
}
async function saveTrack(t) {
  try {
    const d = await dbOpen();
    const tx = d.transaction('tracks', 'readwrite');
    const store = tx.objectStore('tracks');
    await new Promise((res, rej) => {
      const r = store.put({
        id: t.id,
        name: t.name,
        artist: t.artist,
        cover: t.cover,
        spotifyUrl: t.spotifyUrl || null,
        albumId: t.albumId || null,
        albumName: t.albumName || null,
        noData: t.noData || false,
        fileData: t.fileData,
        fileName: t.fileName,
        order: t.order
      });
      r.onsuccess = res;
      r.onerror = rej;
    });
  } catch (e) {
    toast('Aviso: erro ao salvar música.');
    console.error('DB save error:', e);
  }
}
async function deleteTrackFromDB(id) {
  try {
    const d = await dbOpen();
    const tx = d.transaction('tracks', 'readwrite');
    const store = tx.objectStore('tracks');
    await new Promise((res, rej) => {
      const r = store.delete(id);
      r.onsuccess = res;
      r.onerror = rej;
    });
  } catch (e) {
    console.error('DB delete error:', e);
  }
}
function _base64ToBlobURL(dataUrl, mime) {
  try {
    const base64 = dataUrl.split(',')[1];
    const bytes = atob(base64);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([buf], {
      type: mime
    }));
  } catch {
    return dataUrl;
  }
}
async function loadTracks() {
  try {
    const d = await dbOpen();
    const tx = d.transaction('tracks', 'readonly');
    const store = tx.objectStore('tracks');
    tracks = await new Promise((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => {
        const result = r.result || [];
        result.sort((a, b) => (a.order || 0) - (b.order || 0));
        result.forEach(t => {
          if (t.fileData) {
            t.blobUrl = _base64ToBlobURL(t.fileData, 'audio/mpeg');
          }
          if (t.cover && t.cover.startsWith('data:')) {
            const mime = t.cover.split(';')[0].split(':')[1] || 'image/jpeg';
            t.coverUrl = _base64ToBlobURL(t.cover, mime);
          } else if (t.cover && (t.cover.startsWith('http') || t.cover.startsWith('//'))) {
            t.coverUrl = t.cover;
          } else {
            t.coverUrl = null;
          }
        });
        res(result);
      };
      r.onerror = () => res([]);
    });
  } catch (e) {
    tracks = [];
  }
}
function getFiltered() {
  if (!searchQuery) return tracks.map((t, i) => ({
    t,
    i
  }));
  const result = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.name.toLowerCase().includes(searchQuery) || t.artist.toLowerCase().includes(searchQuery)) result.push({
      t,
      i
    });
  }
  return result;
}
function highlight(text, query) {
  if (!query) return escHtml(text);
  const escaped = escHtml(text);
  const escapedQuery = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark style="background:var(--accent-dim);color:var(--accent);border-radius:2px;padding:0 1px;">$1</mark>');
}
function formatArtist(artist) {
  if (!artist) return artist;
  return artist.replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/gi, ', ');
}
function renderTrackHTML(t, i, extraStyle = '') {
  return `<div class="track-item ${i === currentIndex ? 'active' : ''}" onclick="selectTrack(${i})" oncontextmenu="openCtxMenu(event,${i})" onmousedown="trackItemMouseDown(event,${i})" id="ti-${t.id}" data-index="${i}" style="height:${ITEM_H}px;box-sizing:border-box;${extraStyle}">
    <div class="track-drag-handle" onmousedown="dragHandleMouseDown(event,${i})" onclick="event.stopPropagation()" data-tip="Arrastar para reorganizar">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
    </div>
    ${t.coverUrl || t.cover ? `<img class="track-cover" src="${t.coverUrl || t.cover}" alt="">` : `<div class="track-cover-placeholder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`}
    <div class="track-info">
      <div class="track-name" data-tip="${escHtml(t.name)}">${highlight(t.name, searchQuery)}</div>
      <div class="track-artist">${highlight(formatArtist(t.artist), searchQuery)}</div>
    </div>
  </div>`;
}
function renderVirtual() {
  const list = document.getElementById('track-list');
  document.getElementById('track-count').textContent = tracks.length + ' música' + (tracks.length !== 1 ? 's' : '');
  vFilteredCache = getFiltered();
  vTotalItems = vFilteredCache.length;
  vContainerH = list.clientHeight || 500;
  vScrollTop = list.scrollTop;
  if (tracks.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <p>Nenhuma música ainda.<br>Clique em "Adicionar música" para começar.</p>
    </div>`;
    return;
  }
  if (vTotalItems === 0) {
    list.innerHTML = `<div class="search-no-results">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
      <p>Nenhum resultado para<br><strong>"${escHtml(searchQuery)}"</strong></p>
    </div>`;
    return;
  }
  paintVirtual(list, vScrollTop);
}
function paintVirtual(list, scrollTop) {
  if (_trackRemoveLock) return;
  const overscan = 5;
  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_H) - overscan);
  const visible = Math.ceil(vContainerH / ITEM_H) + overscan * 2;
  const endIdx = Math.min(vTotalItems - 1, startIdx + visible);
  const topPad = startIdx * ITEM_H;
  const bottomPad = Math.max(0, (vTotalItems - endIdx - 1) * ITEM_H);
  let html = `<div style="height:${topPad}px;flex-shrink:0;"></div>`;
  const isInitialLoad = !_appReadyForTrackAnim;
  if (isInitialLoad) _appReadyForTrackAnim = true;
  let animIdx = 0;
  for (let vi = startIdx; vi <= endIdx; vi++) {
    const {
      t,
      i
    } = vFilteredCache[vi];
    const trackId = 'ti-' + t.id;
    let extraStyle = '';
    const isNew = !_animatedTrackIds.has(trackId);
    const isPending = _pendingNewTrackId && t.id === _pendingNewTrackId;
    if (isNew || isPending) {
      _animatedTrackIds.add(trackId);
      const delay = isInitialLoad ? animIdx * 40 : 0;
      extraStyle = `animation:track-enter 0.25s ease ${delay}ms both;`;
      animIdx++;
    }
    html += renderTrackHTML(t, i, extraStyle);
  }
  _pendingNewTrackId = null;
  html += `<div style="height:${bottomPad}px;flex-shrink:0;"></div>`;
  list.innerHTML = html;
  if (_dragActive && dragSrcIndex >= 0) {
    const el = document.getElementById('ti-' + tracks[dragSrcIndex]?.id) || document.querySelector(`[data-index="${dragSrcIndex}"]`);
    if (el) el.classList.add('dragging');
    _dragEl = el;
  }
}
function setupVirtualScroll() {
  const list = document.getElementById('track-list');
  list.addEventListener('scroll', () => {
    vScrollTop = list.scrollTop;
    if (tracks.length === 0 || vTotalItems === 0) return;
    paintVirtual(list, vScrollTop);
  });
}
function renderList() {
  renderVirtual();
  renderQueuePanel();
}
function onSearchInput(value) {
  if (currentLibraryView === 'library') {
    filterTracks(value);
  } else {
    filterPlaylists(value);
  }
}
function filterTracks(query) {
  searchQuery = query.trim().toLowerCase();
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchQuery);
  renderList();
}
function filterPlaylists(query) {
  playlistSearchQuery = query.trim().toLowerCase();
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !playlistSearchQuery);
  if (currentPlaylistId) {
    renderPlaylistTracks();
  } else {
    renderPlaylistsView();
  }
}
function clearSearch() {
  searchQuery = '';
  playlistSearchQuery = '';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  if (currentLibraryView === 'library') {
    renderList();
  } else {
    if (currentPlaylistId) renderPlaylistTracks();else renderPlaylistsView();
  }
}
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[c]);
}
function selectTrack(i, fromQueue = false, keepPlaylistContext = false) {
  if (i < 0 || i >= tracks.length) return;
  if (!fromQueue) _preQueueIndex = -1;
  if (!keepPlaylistContext) _playlistContext = null;
  currentIndex = i;
  const _transEl = document.getElementById('track-transition');
  _transEl.classList.remove('flash');
  void _transEl.offsetWidth;
  _transEl.classList.add('flash');
  const t = tracks[i];
  audio.src = t.blobUrl || t.fileData;
  audio.load();
  scrobbled = false;
  nowPlayingTrack = null;
  const pb = document.getElementById('progress-bar');
  if (pb) pb.disabled = false;
  const scrobbleBar = document.getElementById('lfm-scrobble-bar');
  if (scrobbleBar) {
    scrobbleBar.style.setProperty('--scrobble-pct', '0%');
    scrobbleBar.style.display = lfmSessionKey && t.spotifyUrl ? '' : 'none';
  }
  audio.play().then(() => {
    setPlaying(true);
    audio.addEventListener('loadedmetadata', function onMeta() {
      audio.removeEventListener('loadedmetadata', onMeta);
      lfmOnTrackStart(t, audio.duration);
    }, {
      once: true
    });
    if (audio.duration) lfmOnTrackStart(t, audio.duration);
  }).catch(() => setPlaying(false));
  document.getElementById('song-title').textContent = t.name;
  document.getElementById('song-artist').textContent = formatArtist(t.artist);
  document.getElementById('song-artist').style.display = 'block';
  document.getElementById('album-wrap').style.display = 'block';
  const artEl = document.getElementById('album-art');
  const placeholder = document.getElementById('art-placeholder');
  const coverSrc = t.coverUrl || t.cover || null;
  if (coverSrc) {
    artEl.src = coverSrc;
    artEl.classList.remove('hidden');
    placeholder.style.display = 'none';
    document.getElementById('album-wrap').style.display = 'block';
    document.getElementById('bg-blur').style.backgroundImage = `url(${coverSrc})`;
  } else if (t.noData) {
    artEl.classList.add('hidden');
    placeholder.style.display = 'none';
    document.getElementById('album-wrap').style.display = 'none';
    document.getElementById('bg-blur').style.backgroundImage = 'none';
  } else {
    artEl.classList.add('hidden');
    placeholder.style.display = 'flex';
    document.getElementById('bg-blur').style.backgroundImage = 'none';
  }
  renderList();
  if (currentPlaylistId) renderPlaylistTracks();
  const list = document.getElementById('track-list');
  const itemTop = i * ITEM_H;
  const itemBot = itemTop + ITEM_H;
  if (itemTop < list.scrollTop || itemBot > list.scrollTop + list.clientHeight) {
    list.scrollTop = itemTop - list.clientHeight / 2 + ITEM_H / 2;
  }
}
function setPlaying(state) {
  isPlaying = state;
  document.getElementById('icon-play').style.display = state ? 'none' : 'block';
  document.getElementById('icon-pause').style.display = state ? 'block' : 'none';
  const art = document.getElementById('album-art');
  if (state) art.classList.add('playing');else art.classList.remove('playing');
  _updatePlayingPlaylistCard();
}
function togglePlay() {
  if (currentIndex < 0) {
    if (tracks.length > 0) selectTrack(0);
    return;
  }
  if (isPlaying) {
    audio.pause();
  } else {
    audio.play().catch(() => {});
  }
}
function prevTrack() {
  if (tracks.length === 0) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  const plIds = _getPlaylistTrackIds();
  if (plIds && plIds.length > 0) {
    const currentTrackId = tracks[currentIndex]?.id;
    const pos = plIds.indexOf(currentTrackId);
    const prevPos = pos <= 0 ? plIds.length - 1 : pos - 1;
    const idx = tracks.findIndex(t => t.id === plIds[prevPos]);
    if (idx >= 0) {
      selectTrack(idx, false, true);
      return;
    }
  }
  let idx = currentIndex - 1;
  if (idx < 0) idx = tracks.length - 1;
  selectTrack(idx);
}
function nextTrack() {
  if (tracks.length === 0) return;
  if (queue.length > 0) {
    if (_preQueueIndex < 0) _preQueueIndex = currentIndex;
    const nextIdx = queue.shift();
    selectTrack(nextIdx, true);
    return;
  }
  const plIds = _getPlaylistTrackIds();
  if (plIds && plIds.length > 0) {
    const currentTrackId = tracks[currentIndex]?.id;
    let nextId;
    if (isShuffle) {
      if (_plShufflePool.length === 0) {
        _plShufflePool = _buildPlShufflePool(plIds, currentTrackId);
      }
      nextId = _plShufflePool.shift();
      if (!nextId) nextId = plIds[0];
    } else {
      const pos = plIds.indexOf(currentTrackId);
      const nextPos = pos < 0 || pos >= plIds.length - 1 ? 0 : pos + 1;
      nextId = plIds[nextPos];
    }
    const idx = tracks.findIndex(t => t.id === nextId);
    if (idx >= 0) {
      selectTrack(idx, true, true);
      return;
    }
  }
  const baseIndex = _preQueueIndex >= 0 ? _preQueueIndex : currentIndex;
  _preQueueIndex = -1;
  let idx;
  if (isShuffle) {
    idx = shuffleNext();
  } else {
    idx = baseIndex + 1;
    if (idx >= tracks.length) idx = 0;
  }
  selectTrack(idx, true);
}
function _buildShufflePool() {
  const pool = tracks.map((_, i) => i).filter(i => i !== currentIndex);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function shuffleNext() {
  if (tracks.length === 1) return 0;
  if (_shufflePool.length === 0) {
    _shufflePool = _buildShufflePool();
  }
  return _shufflePool.shift();
}
let _plShufflePool = [];
function _buildPlShufflePool(plIds, currentTrackId) {
  const pool = plIds.filter(id => id !== currentTrackId);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function toggleShuffle() {
  isShuffle = !isShuffle;
  _shufflePool = [];
  _plShufflePool = [];
  document.getElementById('btn-shuffle').classList.toggle('active', isShuffle);
}
function toggleRepeat() {
  isRepeat = !isRepeat;
  document.getElementById('btn-repeat').classList.toggle('active', isRepeat);
}
function toggleMute() {
  isMuted = !isMuted;
  audio.muted = isMuted;
  const btn = document.getElementById('btn-mute');
  btn.style.color = isMuted ? 'var(--text-muted)' : '';
  btn.style.opacity = isMuted ? '0.4' : '';
}
function clearNowPlaying() {
  audio.pause();
  audio.src = '';
  currentIndex = -1;
  document.getElementById('song-title').textContent = 'Nenhuma música selecionada';
  document.getElementById('song-artist').style.display = 'none';
  document.getElementById('song-artist').textContent = '—';
  document.getElementById('album-art').classList.add('hidden');
  document.getElementById('art-placeholder').style.display = 'none';
  document.getElementById('album-wrap').style.display = 'none';
  document.getElementById('bg-blur').style.backgroundImage = 'none';
  const pb = document.getElementById('progress-bar');
  if (pb) {
    pb.disabled = true;
    pb.value = 0;
    pb.style.setProperty('--pct', '0%');
  }
  document.getElementById('time-current').textContent = '0:00';
  document.getElementById('time-total').textContent = '0:00';
  scrobbled = false;
  organicListenTime = 0;
  lastTimeUpdatePos = null;
  nowPlayingTrack = null;
  scrobbleThreshold = 0;
  const _bar = document.getElementById('lfm-scrobble-bar');
  if (_bar) {
    _bar.style.setProperty('--scrobble-pct', '0%');
    _bar.style.display = 'none';
  }
}
function _resetScrobbleBar() {
  scrobbled = false;
  organicListenTime = 0;
  lastTimeUpdatePos = null;
  nowPlayingTrack = null;
  scrobbleThreshold = 0;
  const bar = document.getElementById('lfm-scrobble-bar');
  if (bar) {
    bar.style.setProperty('--scrobble-pct', '0%');
    bar.style.display = 'none';
    requestAnimationFrame(() => {
      bar.style.setProperty('--scrobble-pct', '0%');
      bar.style.display = 'none';
    });
  }
}
function deleteTrack(e, i) {
  if (e && e.stopPropagation) e.stopPropagation();
  const t = tracks[i];
  showConfirmDelete(t.name, () => {
    const removedId = t.id;
    const isPlaying = currentIndex === i;
    if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
    if (t.coverUrl && t.coverUrl.startsWith('blob:')) URL.revokeObjectURL(t.coverUrl);
    tracks.splice(i, 1);
    queue = queue.filter(qi => qi !== i).map(qi => qi > i ? qi - 1 : qi);
    _shufflePool = [];
    _preQueueIndex = _preQueueIndex > i ? _preQueueIndex - 1 : _preQueueIndex === i ? -1 : _preQueueIndex;
    if (isPlaying) {
      clearNowPlaying();
      setPlaying(false);
      _resetScrobbleBar();
    } else if (currentIndex > i) {
      currentIndex--;
    }
    deleteTrackFromDB(removedId);
    const ptsToRemove = playlistTracks.filter(pt => pt.trackId === removedId);
    ptsToRemove.forEach(pt => _ptDelete(pt.id).catch(() => {}));
    playlistTracks = playlistTracks.filter(pt => pt.trackId !== removedId);
    renderList();
    if (currentLibraryView !== 'library') {
      if (currentPlaylistId) renderPlaylistDetail();else renderPlaylistsView();
    }
    toast('Música removida.');
  });
}
function setupAudioListeners() {
  audio.addEventListener('ended', () => {
    if (isRepeat) {
      audio.currentTime = 0;
      audio.play();
      scrobbled = false;
      organicListenTime = 0;
      lastTimeUpdatePos = null;
      if (nowPlayingTrack) {
        nowPlayingTrack.startTime = Date.now();
        lfmUpdateNowPlaying(nowPlayingTrack);
      }
      updateScrobbleBar(0, audio.duration);
    } else nextTrack();
  });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', () => {
    document.getElementById('time-total').textContent = formatTime(audio.duration);
  });
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('seeking', () => {
    isSeeking = true;
    lastTimeUpdatePos = null;
  });
  audio.addEventListener('seeked', () => {
    isSeeking = false;
    lastTimeUpdatePos = audio.currentTime;
  });
}
function updateProgress() {
  if (!audio.duration) return;
  const pct = audio.currentTime / audio.duration * 100;
  const bar = document.getElementById('progress-bar');
  bar.value = pct;
  bar.style.setProperty('--pct', pct + '%');
  document.getElementById('time-current').textContent = formatTime(audio.currentTime);
  lfmOnTimeUpdate(audio.currentTime, audio.duration);
}
function setupProgressListeners() {
  const bar = document.getElementById('progress-bar');
  const tooltip = document.getElementById('progress-tooltip');
  bar.addEventListener('mousedown', () => {
    isSeeking = true;
    lastTimeUpdatePos = null;
  });
  bar.addEventListener('input', () => {
    if (audio.duration) {
      audio.currentTime = bar.value / 100 * audio.duration;
      bar.style.setProperty('--pct', bar.value + '%');
    }
  });
  bar.addEventListener('mousemove', e => {
    if (!audio.duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * audio.duration;
    tooltip.textContent = formatTime(time);
    tooltip.style.left = e.clientX + 'px';
    tooltip.style.top = rect.top - 32 + 'px';
    tooltip.classList.add('visible');
  });
  bar.addEventListener('mouseleave', () => {
    tooltip.classList.remove('visible');
  });
  const vol = document.getElementById('volume-slider');
  vol.addEventListener('input', () => {
    audio.volume = vol.value / 100;
    vol.style.setProperty('--vol', vol.value + '%');
  });
}
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  }
  if (e.code === 'ArrowRight') {
    e.preventDefault();
    isSeeking = true;
    lastTimeUpdatePos = null;
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    isSeeking = false;
  }
  if (e.code === 'ArrowLeft') {
    e.preventDefault();
    isSeeking = true;
    lastTimeUpdatePos = null;
    audio.currentTime = Math.max(0, audio.currentTime - 5);
    isSeeking = false;
  }
  if (e.code === 'ArrowUp') {
    e.preventDefault();
    const v = document.getElementById('volume-slider');
    v.value = Math.min(100, +v.value + 5);
    audio.volume = v.value / 100;
    v.style.setProperty('--vol', v.value + '%');
  }
  if (e.code === 'ArrowDown') {
    e.preventDefault();
    const v = document.getElementById('volume-slider');
    v.value = Math.max(0, +v.value - 5);
    audio.volume = v.value / 100;
    v.style.setProperty('--vol', v.value + '%');
  }
  if (e.code === 'KeyN') nextTrack();
  if (e.code === 'KeyP') prevTrack();
});
function lfmInit() {
  (async () => {
    lfmApiKey = await loadSecret('lfm_key');
    lfmApiSecret = await loadSecret('lfm_secret');
    lfmSessionKey = await loadSecret('lfm_session');
    lfmUsername = (await loadSecret('lfm_user')) || '';
    if (lfmApiKey) {
      const el = document.getElementById('lfm-api-key');
      if (el) el.value = lfmApiKey;
    }
    if (lfmApiSecret) {
      const el = document.getElementById('lfm-api-secret');
      if (el) el.value = lfmApiSecret;
    }
    lfmUpdateStatusUI();
  })();
}
function lfmStatusClick() {
  toggleSettingsPanel(true);
}
function lfmUpdateStatusUI() {
  const el = document.getElementById('lastfm-status');
  const txt = document.getElementById('lfm-status-text');
  if (!el) return;
  if (lfmSessionKey) {
    el.classList.add('connected');
    el.classList.remove('scrobbling');
    if (txt) txt.textContent = lfmUsername || '';
    el.title = lfmUsername ? `Last.fm: ${lfmUsername}` : 'Last.fm conectado';
    if (currentIndex >= 0 && tracks[currentIndex]?.spotifyUrl && !scrobbled) {
      const bar = document.getElementById('lfm-scrobble-bar');
      if (bar) bar.style.display = '';
    }
  } else {
    el.classList.remove('connected', 'scrobbling');
    if (txt) txt.textContent = '';
    el.title = lfmApiKey ? 'Last.fm: clique para autenticar' : 'Last.fm: clique para conectar';
    scrobbleThreshold = 0;
    nowPlayingTrack = null;
    const bar = document.getElementById('lfm-scrobble-bar');
    if (bar) {
      bar.style.display = 'none';
      bar.style.setProperty('--scrobble-pct', '0%');
    }
  }
  updateSettingsLfmRow();
}
function lfmOpenSettings() {
  document.getElementById('setup-overlay').classList.remove('hidden');
  switchTab('lastfm');
  (async () => {
    document.getElementById('lfm-api-key').value = (await loadSecret('lfm_key')) || '';
    document.getElementById('lfm-api-secret').value = (await loadSecret('lfm_secret')) || '';
  })();
}
function lfmDisconnect() {
  if (!confirm('Desconectar Last.fm? Scrobbles não serão mais registrados.')) return;
  removeSecret('lfm_session');
  removeSecret('lfm_user');
  localStorage.removeItem('lfm_pending_token');
  lfmSessionKey = null;
  lfmUsername = null;
  lfmPendingToken = null;
  lfmUpdateStatusUI();
  toast('Last.fm desconectado.');
}
async function lfmStartAuth() {
  const key = document.getElementById('lfm-api-key').value.trim();
  const sec = document.getElementById('lfm-api-secret').value.trim();
  if (!key || !sec) {
    _showSetupWarn('lfm-warn-tooltip', 'lfm-warn-text', 'Preencha a API Key e o Shared Secret.');
    return;
  }
  try {
    await saveSecret('lfm_key', key);
    await saveSecret('lfm_secret', sec);
  } catch (e) {
    _showSetupWarn('lfm-warn-tooltip', 'lfm-warn-text', 'Erro ao salvar — tente novamente.');
    return;
  }
  lfmApiKey = key;
  lfmApiSecret = sec;
  _showSetupWarn('lfm-warn-tooltip', 'lfm-warn-text', 'Obtendo token...');
  try {
    const token = await lfmGetToken();
    lfmPendingToken = token;
    localStorage.setItem('lfm_pending_token', token);
    const authUrl = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
    document.getElementById('lfm-auth-link').href = authUrl;
    document.getElementById('lfm-modal-status').textContent = '';
    document.getElementById('setup-overlay').classList.add('hidden');
    document.getElementById('lfm-auth-modal').classList.remove('hidden');
    const tip = document.getElementById('lfm-warn-tooltip');
    if (tip) {
      tip.classList.remove('visible');
      setTimeout(() => tip.classList.add('hidden'), 250);
    }
  } catch (e) {
    _showSetupWarn('lfm-warn-tooltip', 'lfm-warn-text', '✗ ' + e.message);
  }
}
async function lfmGetToken() {
  const params = {
    method: 'auth.getToken',
    api_key: lfmApiKey
  };
  const sig = lfmSign(params);
  const url = `https://ws.audioscrobbler.com/2.0/?method=auth.getToken&api_key=${lfmApiKey}&api_sig=${sig}&format=json`;
  const res = await lfmFetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.message || 'Erro ao obter token');
  return data.token;
}
async function lfmGetSession() {
  const btn = document.getElementById('lfm-session-btn');
  const status = document.getElementById('lfm-modal-status');
  btn.disabled = true;
  btn.textContent = '...';
  status.textContent = 'Verificando autorização...';
  const token = lfmPendingToken || localStorage.getItem('lfm_pending_token');
  if (!token) {
    status.textContent = '✗ Token expirado. Reinicie a autenticação.';
    btn.disabled = false;
    btn.textContent = 'Já autorizei ✓';
    return;
  }
  try {
    const params = {
      method: 'auth.getSession',
      api_key: lfmApiKey,
      token
    };
    const sig = lfmSign(params);
    const url = `https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${lfmApiKey}&token=${token}&api_sig=${sig}&format=json`;
    const res = await lfmFetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.message || 'Erro ao obter sessão. Verifique se clicou em Allow no Last.fm.');
    lfmSessionKey = data.session.key;
    lfmUsername = data.session.name;
    await saveSecret('lfm_session', lfmSessionKey);
    await saveSecret('lfm_user', lfmUsername);
    localStorage.removeItem('lfm_pending_token');
    document.getElementById('lfm-auth-modal').classList.add('hidden');
    document.getElementById('setup-overlay').classList.add('hidden');
    lfmUpdateStatusUI();
    toast(`Last.fm conectado como ${lfmUsername}! 🔴`);
  } catch (e) {
    status.textContent = '✗ ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Já autorizei ✓';
  }
}
function lfmSign(params) {
  const sorted = Object.keys(params).sort().map(k => k + params[k]).join('');
  return md5(unescape(encodeURIComponent(sorted + lfmApiSecret)));
}
async function lfmFetch(url, options) {
  try {
    const r = await fetch(url, options);
    if (!r.ok) throw new Error('status ' + r.status);
    return r;
  } catch (e) {
    const proxy = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const r2 = await fetch(proxy, options);
    if (!r2.ok) throw new Error('Erro na requisição Last.fm');
    return r2;
  }
}
async function lfmPost(params) {
  const p = Object.assign({}, params);
  p.api_key = lfmApiKey;
  p.sk = lfmSessionKey;
  p.format = 'json';
  const sig = lfmSign(Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'format')));
  p.api_sig = sig;
  const body = new URLSearchParams(p).toString();
  const url = 'https://ws.audioscrobbler.com/2.0/';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    return await r.json();
  } catch (e) {
    const proxy = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const r2 = await fetch(proxy, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    return await r2.json();
  }
}
async function lfmUpdateNowPlaying(track) {
  if (!lfmSessionKey || !lfmApiKey) return;
  try {
    await lfmPost({
      method: 'track.updateNowPlaying',
      track: track.name,
      artist: (track.artist || '').split(',')[0].trim(),
      duration: Math.round(track.duration) || ''
    });
  } catch (e) {}
}
async function lfmScrobble(track) {
  if (!lfmSessionKey || !lfmApiKey) return;
  try {
    const data = await lfmPost({
      method: 'track.scrobble',
      track: track.name,
      artist: (track.artist || '').split(',')[0].trim(),
      timestamp: Math.round(track.startTime / 1000),
      duration: Math.round(track.duration) || ''
    });
    if (data.error) {
      console.warn('Last.fm scrobble error:', data.message);
    } else {
      const el = document.getElementById('lastfm-status');
      if (el) {
        el.classList.add('scrobbling');
        setTimeout(() => {
          el.classList.remove('scrobbling');
          lfmUpdateStatusUI();
        }, 3000);
      }
      toast(`Scrobble: ${track.name}`);
    }
  } catch (e) {
    console.warn('Last.fm scrobble failed:', e);
  }
}
function lfmOnTrackStart(trackObj, duration) {
  clearTimeout(scrobbleTimer);
  scrobbled = false;
  organicListenTime = 0;
  lastTimeUpdatePos = null;
  isSeeking = false;
  nowPlayingTrack = {
    name: trackObj.name || trackObj.fileName || '',
    artist: trackObj.artist || '',
    duration: duration,
    startTime: Date.now()
  };
  if (duration > 30) {
    scrobbleThreshold = Math.min(duration * 0.5, 240);
  } else {
    scrobbleThreshold = 0;
  }
  if (lfmSessionKey) {
    lfmUpdateNowPlaying(nowPlayingTrack);
  }
  const bar = document.getElementById('lfm-scrobble-bar');
  if (bar) {
    bar.style.display = lfmSessionKey && trackObj.spotifyUrl ? '' : 'none';
    bar.style.setProperty('--scrobble-pct', '0%');
  }
  updateScrobbleBar(0, duration);
}
function lfmOnTimeUpdate(currentTime, duration) {
  if (!nowPlayingTrack || scrobbled || scrobbleThreshold === 0) return;
  if (!isSeeking && lastTimeUpdatePos !== null) {
    const delta = currentTime - lastTimeUpdatePos;
    if (delta > 0 && delta <= 2) {
      organicListenTime += delta;
    }
  }
  lastTimeUpdatePos = currentTime;
  updateScrobbleBar(organicListenTime, duration);
  if (organicListenTime >= scrobbleThreshold) {
    scrobbled = true;
    (async () => {
      const t = currentIndex >= 0 ? tracks[currentIndex] : null;
      if (t && typeof statsIncrementTrack === 'function') {
        await statsIncrementTrack(t);
        const activePlContext = _playlistContext || currentPlaylistId;
        if (activePlContext && typeof statsIncrementPlaylist === 'function') {
          await statsIncrementPlaylist(activePlContext);
        }
        _refreshStatsIfOpen();
      }
    })();
    lfmScrobble(nowPlayingTrack);
    const bar = document.getElementById('lfm-scrobble-bar');
    if (bar) bar.style.setProperty('--scrobble-pct', '100%');
  }
}
function updateScrobbleBar(listenedTime, duration) {
  if (!lfmSessionKey || !duration || scrobbleThreshold === 0) return;
  const bar = document.getElementById('lfm-scrobble-bar');
  if (!bar) return;
  const pct = Math.min(listenedTime / scrobbleThreshold * 100, 100);
  bar.style.setProperty('--scrobble-pct', pct.toFixed(1) + '%');
}
function md5(inputString) {
  var hc = "0123456789abcdef";
  function rh(n) {
    var j,
      s = "";
    for (j = 0; j <= 3; j++) s += hc.charAt(n >> j * 8 + 4 & 0x0F) + hc.charAt(n >> j * 8 & 0x0F);
    return s;
  }
  function ad(x, y) {
    var l = (x & 0xFFFF) + (y & 0xFFFF);
    var m = (x >> 16) + (y >> 16) + (l >> 16);
    return m << 16 | l & 0xFFFF;
  }
  function rl(n, c) {
    return n << c | n >>> 32 - c;
  }
  function cm(q, a, b, x, s, t) {
    return ad(rl(ad(ad(a, q), ad(x, t)), s), b);
  }
  function ff(a, b, c, d, x, s, t) {
    return cm(b & c | ~b & d, a, b, x, s, t);
  }
  function gg(a, b, c, d, x, s, t) {
    return cm(b & d | c & ~d, a, b, x, s, t);
  }
  function hh(a, b, c, d, x, s, t) {
    return cm(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a, b, c, d, x, s, t) {
    return cm(c ^ (b | ~d), a, b, x, s, t);
  }
  function sb(x) {
    var i,
      nblk = (x.length + 8 >> 6) + 1,
      blks = new Array(nblk * 16);
    for (i = 0; i < nblk * 16; i++) blks[i] = 0;
    for (i = 0; i < x.length; i++) blks[i >> 2] |= x.charCodeAt(i) << i % 4 * 8;
    blks[i >> 2] |= 0x80 << i % 4 * 8;
    blks[nblk * 16 - 2] = x.length * 8;
    return blks;
  }
  var i,
    x = sb(inputString),
    a = 1732584193,
    b = -271733879,
    c = -1732584194,
    d = 271733878,
    olda,
    oldb,
    oldc,
    oldd;
  for (i = 0; i < x.length; i += 16) {
    olda = a;
    oldb = b;
    oldc = c;
    oldd = d;
    a = ff(a, b, c, d, x[i + 0], 7, -680876936);
    d = ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10], 17, -42063);
    b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = gg(b, c, d, a, x[i + 0], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, x[i + 5], 4, -378558);
    d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = hh(d, a, b, c, x[i + 0], 11, -358537222);
    c = hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = ii(a, b, c, d, x[i + 0], 6, -198630844);
    d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = ad(a, olda);
    b = ad(b, oldb);
    c = ad(c, oldc);
    d = ad(d, oldd);
  }
  return rh(a) + rh(b) + rh(c) + rh(d);
}
function showConfirmDelete(trackName, onConfirm) {
  _confirmCallback = onConfirm;
  document.getElementById('confirm-msg').innerHTML = `Tem certeza que deseja remover <strong>"${escHtml(trackName)}"</strong> da sua biblioteca? Esta ação não pode ser desfeita.`;
  document.getElementById('confirm-yes-btn').onclick = () => {
    const cb = _confirmCallback;
    closeConfirmDelete();
    if (cb) cb();
  };
  document.getElementById('confirm-overlay').classList.remove('hidden');
}
function closeConfirmDelete() {
  document.getElementById('confirm-overlay').classList.add('hidden');
  _confirmCallback = null;
}
document.getElementById('confirm-overlay').addEventListener('click', function (e) {
  if (e.target === this) closeConfirmDelete();
});
function _positionCtxMenu(menu, clientX, clientY) {
  const MARGIN = 8;
  menu.style.left = '-9999px';
  menu.style.top = '-9999px';
  menu.style.visibility = 'hidden';
  const mw = menu.offsetWidth || 220;
  const mh = menu.offsetHeight || 120;
  menu.style.visibility = '';
  let x = clientX;
  let y = clientY;
  if (x + mw + MARGIN > window.innerWidth) x = clientX - mw;
  if (x < MARGIN) x = MARGIN;
  if (y + mh + MARGIN > window.innerHeight) y = clientY - mh;
  if (y < MARGIN) y = MARGIN;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}
function openCtxMenu(e, index) {
  e.preventDefault();
  e.stopPropagation();
  ctxTargetIndex = index;
  const menu = document.getElementById('ctx-menu');
  delete menu.dataset.playlistMode;
  _applyCtxMenuPlaylistMode(false);
  const t = tracks[index];
  const isNoData = t && t.noData;
  const addDataItem = document.getElementById('ctx-item-adddata');
  const addDataSep = document.getElementById('ctx-sep-adddata');
  if (addDataItem) addDataItem.style.display = isNoData ? '' : 'none';
  if (addDataSep) addDataSep.style.display = isNoData ? '' : 'none';
  menu.classList.add('visible');
  _positionCtxMenu(menu, e.clientX, e.clientY);
}
function closeCtxMenu() {
  const menu = document.getElementById('ctx-menu');
  menu.classList.remove('visible');
  if (menu.dataset.playlistMode) {
    delete menu.dataset.playlistMode;
    _applyCtxMenuPlaylistMode(false);
  }
  ctxTargetIndex = -1;
  _ctxPlaylistTrackPtId = null;
  closeCtxPlaylistMenu();
}
function ctxAddToQueue() {
  if (ctxTargetIndex < 0) return;
  queue.push(ctxTargetIndex);
  toast(`"${tracks[ctxTargetIndex]?.name}" adicionada à fila! `);
  closeCtxMenu();
  renderList();
}
function ctxPlayNext() {
  if (ctxTargetIndex < 0) return;
  queue.unshift(ctxTargetIndex);
  toast(`"${tracks[ctxTargetIndex]?.name}" vai tocar em seguida! `);
  closeCtxMenu();
  renderList();
}
function ctxAddData() {
  if (ctxTargetIndex < 0) return;
  const savedIndex = ctxTargetIndex;
  const t = tracks[savedIndex];
  if (!t) return;
  closeCtxMenu();
  pendingFile = null;
  window._editDataTrackIndex = savedIndex;
  document.getElementById('modal-title').textContent = 'Adicionar dados à música';
  document.getElementById('modal-hint').textContent = 'Cole o link do Spotify para "' + t.name + '" e busque automaticamente a capa, nome e artista.';
  document.getElementById('modal-spotify-url').value = '';
  _modalUrlErrClear();
  document.getElementById('btn-no-data').style.display = 'none';
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-spotify-url').focus(), 100);
}
function ctxRemove() {
  if (ctxTargetIndex < 0) return;
  const i = ctxTargetIndex;
  closeCtxMenu();
  const t = tracks[i];
  if (!t) return;
  showConfirmDelete(t.name, () => {
    const el = document.getElementById('ti-' + t.id);
    const doRemove = () => {
      if (t.blobUrl) URL.revokeObjectURL(t.blobUrl);
      if (t.coverUrl && t.coverUrl.startsWith('blob:')) URL.revokeObjectURL(t.coverUrl);
      tracks.splice(i, 1);
      queue = queue.filter(qi => qi !== i).map(qi => qi > i ? qi - 1 : qi);
      _shufflePool = [];
      _preQueueIndex = _preQueueIndex > i ? _preQueueIndex - 1 : _preQueueIndex === i ? -1 : _preQueueIndex;
      const _isPlaying = currentIndex === i;
      if (_isPlaying) {
        clearNowPlaying();
        setPlaying(false);
        _resetScrobbleBar();
      } else if (currentIndex > i) currentIndex--;
      deleteTrackFromDB(t.id);
      const ptsToRemove = playlistTracks.filter(pt => pt.trackId === t.id);
      ptsToRemove.forEach(pt => _ptDelete(pt.id).catch(() => {}));
      playlistTracks = playlistTracks.filter(pt => pt.trackId !== t.id);
      _animatedTrackIds.delete('ti-' + t.id);
      renderList();
      if (currentLibraryView !== 'library') {
        if (currentPlaylistId) renderPlaylistDetail();else renderPlaylistsView();
      }
      toast(`"${t.name}" removida.`);
    };
    if (el) {
      _trackRemoveLock = true;
      el.classList.add('track-removing');
      setTimeout(() => {
        _trackRemoveLock = false;
        doRemove();
      }, 600);
    } else {
      doRemove();
    }
  });
}
function openClearLibraryModal() {
  closeSettingsPanel();
  document.getElementById('clear-library-modal').classList.remove('hidden');
}
function closeClearLibraryModal() {
  document.getElementById('clear-library-modal').classList.add('hidden');
}
function confirmClearDatabase() {
  closeClearLibraryModal();
  tracks = [];
  currentIndex = -1;
  renderList();
  if (db) {
    try {
      db.close();
    } catch (e) {}
    db = null;
  }
  const req = indexedDB.deleteDatabase('player_db');
  req.onsuccess = () => location.reload();
  req.onerror = () => location.reload();
  req.onblocked = () => location.reload();
}
function clearDatabase() {
  openClearLibraryModal();
}
function toggleQueuePanel() {
  document.getElementById('queue-panel').classList.toggle('hidden');
}
function closeQueuePanel() {
  document.getElementById('queue-panel').classList.add('hidden');
}
function clearQueue() {
  queue = [];
  _preQueueIndex = -1;
  renderQueuePanel();
  toast('Fila limpa.');
}
function removeFromQueue(e, qPos) {
  e.stopPropagation();
  const item = document.querySelector(`#queue-panel-list .queue-panel-item[data-qpos="${qPos}"]`);
  if (item) {
    item.classList.add('qp-removing');
    item.addEventListener('animationend', () => {
      queue.splice(qPos, 1);
      renderQueuePanel();
    }, {
      once: true
    });
  } else {
    queue.splice(qPos, 1);
    renderQueuePanel();
  }
}
function playFromQueue(qPos) {
  const trackIdx = queue[qPos];
  queue.splice(qPos, 1);
  selectTrack(trackIdx);
}
function renderQueuePanel() {
  const list = document.getElementById('queue-panel-list');
  const btn = document.getElementById('btn-queue');
  const clearBtn = document.getElementById('btn-clear-queue');
  if (!list) return;
  if (queue.length > 0) {
    btn.classList.add('has-queue');
    if (clearBtn) clearBtn.style.display = '';
  } else {
    btn.classList.remove('has-queue');
    if (clearBtn) clearBtn.style.display = 'none';
  }
  if (queue.length === 0) {
    list.innerHTML = `<div class="queue-panel-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
      Fila vazia.<br>Clique direito em uma música<br>para adicioná-la.
    </div>`;
    return;
  }
  list.innerHTML = queue.map((trackIdx, qPos) => {
    const t = tracks[trackIdx];
    if (!t) return '';
    return `<div class="queue-panel-item" data-qpos="${qPos}" onmousedown="queueItemMouseDown(event,${qPos})" onclick="playFromQueue(${qPos})">
      <span class="qp-num">${qPos + 1}</span>
      ${t.coverUrl || t.cover ? `<img class="qp-cover" src="${t.coverUrl || t.cover}" alt="">` : `<div class="qp-cover-ph"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`}
      <div class="qp-info"><div class="qp-name">${escHtml(t.name)}</div><div class="qp-artist">${escHtml(formatArtist(t.artist))}</div></div>
      <button class="qp-remove" onclick="removeFromQueue(event,${qPos})" data-tip="Remover da fila">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');
}
let _qDragSrc = -1;
let _qDragEl = null;
let _qDragActive = false;
let _qDragPending = false;
let _qDragPendingPos = -1;
let _qDragStartX = 0;
let _qDragStartY = 0;
let _qDragLeftItem = false;
const Q_DRAG_THRESHOLD = 5;
function _qInitDrag(qPos) {
  _qDragSrc = qPos;
  _qDragEl = document.querySelector(`#queue-panel-list .queue-panel-item[data-qpos="${qPos}"]`);
  if (_qDragEl) _qDragEl.classList.add('qp-dragging');
  _qDragActive = true;
  _qDragPending = false;
  _autoScrollStart(document.getElementById('queue-panel-list'));
  if (!_autoScrollRAF) _autoScrollRAF = requestAnimationFrame(_autoScrollTick);
}
function queueItemMouseDown(e, qPos) {
  if (e.target.closest('.qp-drag-handle')) return;
  if (e.button !== 0) return;
  _qDragPending = true;
  _qDragPendingPos = qPos;
  _qDragStartX = e.clientX;
  _qDragStartY = e.clientY;
  _qDragLeftItem = false;
  document.addEventListener('mousemove', _onQPendingMouseMove);
  document.addEventListener('mouseup', _onQPendingMouseUp);
}
function _onQPendingMouseMove(e) {
  if (!_qDragPending) return;
  const dx = Math.abs(e.clientX - _qDragStartX);
  const dy = Math.abs(e.clientY - _qDragStartY);
  if (dx > Q_DRAG_THRESHOLD || dy > Q_DRAG_THRESHOLD) {
    _qDragLeftItem = true;
    _qDragPending = false;
    document.removeEventListener('mousemove', _onQPendingMouseMove);
    document.removeEventListener('mouseup', _onQPendingMouseUp);
    _qInitDrag(_qDragPendingPos);
    document.addEventListener('mousemove', _onQDragMouseMove);
    document.addEventListener('mouseup', _onQDragMouseUp);
  }
}
function _onQPendingMouseUp(e) {
  _qDragPending = false;
  _qDragPendingPos = -1;
  document.removeEventListener('mousemove', _onQPendingMouseMove);
  document.removeEventListener('mouseup', _onQPendingMouseUp);
  if (_qDragLeftItem) {
    _qDragLeftItem = false;
    const suppress = ev => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    };
    document.addEventListener('click', suppress, {
      capture: true,
      once: true
    });
  }
}
function _qGetItemAtY(clientY) {
  const items = document.querySelectorAll('#queue-panel-list .queue-panel-item[data-qpos]');
  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) return el;
  }
  return null;
}
function _onQDragMouseMove(e) {
  if (!_qDragActive) return;
  _autoScrollUpdate(e.clientY);
  document.querySelectorAll('.qp-drag-over-top,.qp-drag-over-bottom').forEach(el => el.classList.remove('qp-drag-over-top', 'qp-drag-over-bottom'));
  const target = _qGetItemAtY(e.clientY);
  if (!target) return;
  const ti = parseInt(target.dataset.qpos);
  if (ti === _qDragSrc) return;
  const rect = target.getBoundingClientRect();
  target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'qp-drag-over-top' : 'qp-drag-over-bottom');
}
function _onQDragMouseUp(e) {
  if (!_qDragActive) return;
  _qDragActive = false;
  _autoScrollStop();
  document.removeEventListener('mousemove', _onQDragMouseMove);
  document.removeEventListener('mouseup', _onQDragMouseUp);
  if (_qDragEl) _qDragEl.classList.remove('qp-dragging');
  _qDragEl = null;
  document.querySelectorAll('.qp-drag-over-top,.qp-drag-over-bottom').forEach(el => el.classList.remove('qp-drag-over-top', 'qp-drag-over-bottom'));
  const suppress = ev => {
    ev.stopImmediatePropagation();
    ev.preventDefault();
  };
  document.addEventListener('click', suppress, {
    capture: true,
    once: true
  });
  if (_qDragSrc < 0) return;
  const target = _qGetItemAtY(e.clientY);
  if (!target) {
    _qDragSrc = -1;
    return;
  }
  const ti = parseInt(target.dataset.qpos);
  if (ti === _qDragSrc) {
    _qDragSrc = -1;
    return;
  }
  const rect = target.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  const moved = queue.splice(_qDragSrc, 1)[0];
  let insertAt = ti;
  if (_qDragSrc < ti) insertAt = ti - 1;
  if (!before) insertAt += 1;
  queue.splice(insertAt, 0, moved);
  _qDragSrc = -1;
  renderQueuePanel();
}
function _initDrag(index) {
  dragSrcIndex = index;
  _dragEl = document.getElementById('ti-' + tracks[index]?.id) || document.querySelector(`[data-index="${index}"]`);
  if (_dragEl) _dragEl.classList.add('dragging');
  _dragActive = true;
  _dragPending = false;
  _autoScrollStart(document.getElementById('track-list'));
  if (!_autoScrollRAF) _autoScrollRAF = requestAnimationFrame(_autoScrollTick);
}
function dragHandleMouseDown(e, index) {
  e.preventDefault();
  e.stopPropagation();
  _dragPending = false;
  _initDrag(index);
  document.addEventListener('mousemove', _onDragMouseMove);
  document.addEventListener('mouseup', _onDragMouseUp);
}
function trackItemMouseDown(e, index) {
  if (e.target.closest('.track-drag-handle')) return;
  if (e.button !== 0) return;
  _dragPending = true;
  _dragPendingIndex = index;
  _dragStartX = e.clientX;
  _dragStartY = e.clientY;
  _dragLeftItem = false;
  document.addEventListener('mousemove', _onPendingMouseMove);
  document.addEventListener('mouseup', _onPendingMouseUp);
}
function _onPendingMouseMove(e) {
  if (!_dragPending) return;
  const dx = Math.abs(e.clientX - _dragStartX);
  const dy = Math.abs(e.clientY - _dragStartY);
  if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
    _dragLeftItem = true;
    _dragPending = false;
    document.removeEventListener('mousemove', _onPendingMouseMove);
    document.removeEventListener('mouseup', _onPendingMouseUp);
    _initDrag(_dragPendingIndex);
    document.addEventListener('mousemove', _onDragMouseMove);
    document.addEventListener('mouseup', _onDragMouseUp);
  }
}
function _onPendingMouseUp(e) {
  _dragPending = false;
  _dragPendingIndex = -1;
  document.removeEventListener('mousemove', _onPendingMouseMove);
  document.removeEventListener('mouseup', _onPendingMouseUp);
  if (_dragLeftItem) {
    _dragLeftItem = false;
    const suppress = ev => {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    };
    document.addEventListener('click', suppress, {
      capture: true,
      once: true
    });
  }
}
function _getItemAtY(clientY) {
  const items = document.querySelectorAll('#track-list .track-item[data-index]');
  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) return el;
  }
  return null;
}
let _autoScrollRAF = null;
let _autoScrollEl = null;
let _autoScrollDir = 0;
let _autoScrollSpeed = 6;
const AUTO_SCROLL_ZONE = 48;
const AUTO_SCROLL_SPEED_MAIN = 6;
const AUTO_SCROLL_SPEED_QUEUE = 3;
function _autoScrollStart(containerEl) {
  _autoScrollEl = containerEl;
  _autoScrollSpeed = containerEl.id === 'queue-panel-list' ? AUTO_SCROLL_SPEED_QUEUE : AUTO_SCROLL_SPEED_MAIN;
}
function _autoScrollUpdate(clientY) {
  if (!_autoScrollEl) return;
  const rect = _autoScrollEl.getBoundingClientRect();
  if (clientY < rect.top + AUTO_SCROLL_ZONE) {
    _autoScrollDir = -1;
  } else if (clientY > rect.bottom - AUTO_SCROLL_ZONE) {
    _autoScrollDir = 1;
  } else {
    _autoScrollDir = 0;
  }
}
function _autoScrollTick() {
  if (_autoScrollEl && _autoScrollDir !== 0) {
    _autoScrollEl.scrollTop += _autoScrollDir * _autoScrollSpeed;
  }
  _autoScrollRAF = requestAnimationFrame(_autoScrollTick);
}
function _autoScrollStop() {
  _autoScrollDir = 0;
  _autoScrollEl = null;
  if (_autoScrollRAF) {
    cancelAnimationFrame(_autoScrollRAF);
    _autoScrollRAF = null;
  }
}
function _onDragMouseMove(e) {
  if (!_dragActive) return;
  _autoScrollUpdate(e.clientY);
  document.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
  const target = _getItemAtY(e.clientY);
  if (!target) return;
  const ti = parseInt(target.dataset.index);
  if (ti === dragSrcIndex) return;
  const rect = target.getBoundingClientRect();
  target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
}
function _onDragMouseUp(e) {
  if (!_dragActive) return;
  _dragActive = false;
  _autoScrollStop();
  document.removeEventListener('mousemove', _onDragMouseMove);
  document.removeEventListener('mouseup', _onDragMouseUp);
  if (_dragEl) _dragEl.classList.remove('dragging');
  _dragEl = null;
  document.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
  const suppress = ev => {
    ev.stopImmediatePropagation();
    ev.preventDefault();
  };
  document.addEventListener('click', suppress, {
    capture: true,
    once: true
  });
  if (dragSrcIndex < 0) return;
  const target = _getItemAtY(e.clientY);
  if (!target) {
    dragSrcIndex = -1;
    return;
  }
  const ti = parseInt(target.dataset.index);
  if (ti === dragSrcIndex) {
    dragSrcIndex = -1;
    return;
  }
  const rect = target.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  const currentId = currentIndex >= 0 ? tracks[currentIndex]?.id : null;
  const moved = tracks.splice(dragSrcIndex, 1)[0];
  let insertAt = ti;
  if (dragSrcIndex < ti) insertAt = ti - 1;
  if (!before) insertAt += 1;
  tracks.splice(insertAt, 0, moved);
  tracks.forEach((t, idx) => {
    t.order = idx;
    saveTrack(t);
  });
  if (currentId) currentIndex = tracks.findIndex(t => t.id === currentId);
  queue = queue.map(qi => {
    if (qi === dragSrcIndex) return insertAt;
    let n = qi;
    if (dragSrcIndex < n) n--;
    if (insertAt <= n && dragSrcIndex > qi) n++;
    return n;
  });
  dragSrcIndex = -1;
  renderList();
}
function toggleSettingsPanel(forceOpen) {
  const panel = document.getElementById('settings-panel');
  const btn = document.getElementById('btn-gear');
  const isHidden = panel.classList.contains('hidden');
  if (!forceOpen && !isHidden) {
    panel.classList.add('hidden');
    btn.classList.remove('active');
    return;
  }
  (async () => {
    document.getElementById('cfg-sp-cid').value = (await loadSecret('sp_cid')) || '';
    document.getElementById('cfg-sp-cs').value = (await loadSecret('sp_cs')) || '';
    document.getElementById('cfg-lfm-key').value = (await loadSecret('lfm_key')) || '';
    document.getElementById('cfg-lfm-secret').value = (await loadSecret('lfm_secret')) || '';
    updateSettingsLfmRow();
  })();
  panel.classList.remove('hidden');
  btn.classList.add('active');
}
function closeSettingsPanel() {
  document.getElementById('settings-panel').classList.add('hidden');
  document.getElementById('btn-gear').classList.remove('active');
}
function saveSettingsSpotify() {
  const cid = document.getElementById('cfg-sp-cid').value.trim();
  const cs = document.getElementById('cfg-sp-cs').value.trim();
  if (!cid || !cs) {
    toast('Preencha Client ID e Secret.');
    return;
  }
  (async () => {
    try {
      await saveSecret('sp_cid', cid);
      await saveSecret('sp_cs', cs);
      spotifyToken = null;
      toast('Credenciais do Spotify salvas ✓');
    } catch (e) {
      toast('Erro ao salvar credenciais — tente novamente.');
    }
  })();
}
function saveSettingsLfm() {
  const key = document.getElementById('cfg-lfm-key').value.trim();
  const sec = document.getElementById('cfg-lfm-secret').value.trim();
  if (!key || !sec) {
    toast('Preencha API Key e Shared Secret.');
    return;
  }
  (async () => {
    try {
      await saveSecret('lfm_key', key);
      await saveSecret('lfm_secret', sec);
      lfmApiKey = key;
      lfmApiSecret = sec;
      closeSettingsPanel();
      lfmUpdateStatusUI();
      await lfmStartAuthFromSettings(key, sec);
    } catch (e) {
      toast('Erro ao salvar credenciais — tente novamente.');
    }
  })();
}
async function lfmStartAuthFromSettings(key, sec) {
  try {
    const token = await lfmGetToken();
    lfmPendingToken = token;
    localStorage.setItem('lfm_pending_token', token);
    const authUrl = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
    document.getElementById('lfm-auth-link').href = authUrl;
    document.getElementById('lfm-modal-status').textContent = '';
    document.getElementById('setup-overlay').classList.add('hidden');
    document.getElementById('lfm-auth-modal').classList.remove('hidden');
  } catch (e) {
    toast('Last.fm: ' + e.message);
  }
}
function settingsLfmDisconnect() {
  removeSecret('lfm_session');
  removeSecret('lfm_user');
  localStorage.removeItem('lfm_pending_token');
  lfmSessionKey = null;
  lfmUsername = null;
  lfmPendingToken = null;
  lfmUpdateStatusUI();
  toast('Last.fm desconectado.');
}
function updateSettingsLfmRow() {
  const row = document.getElementById('settings-lfm-row');
  const label = document.getElementById('settings-lfm-label');
  const btn = document.getElementById('settings-lfm-disconnect');
  if (!row) return;
  if (lfmSessionKey) {
    row.classList.add('connected');
    if (label) label.textContent = lfmUsername ? `Conectado como ${lfmUsername}` : 'Conectado';
    if (btn) btn.classList.remove('hidden');
  } else {
    row.classList.remove('connected');
    if (label) label.textContent = 'Não conectado';
    if (btn) btn.classList.add('hidden');
  }
}
(function () {
  const tip = document.getElementById('custom-tooltip');
  function showTip(e, text) {
    tip.textContent = text;
    tip.classList.add('visible');
    moveTip(e);
  }
  function moveTip(e) {
    const tw = tip.offsetWidth,
      th = tip.offsetHeight;
    let x = e.clientX + 12,
      y = e.clientY - th - 10;
    if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 12;
    if (y < 8) y = e.clientY + 16;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    if (el.classList.contains('track-name') && el.scrollWidth <= el.clientWidth) return;
    showTip(e, el.dataset.tip);
  });
  document.addEventListener('mousemove', e => {
    if (tip.classList.contains('visible')) moveTip(e);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-tip]')) tip.classList.remove('visible');
  });
  document.addEventListener('click', () => tip.classList.remove('visible'));
  const hideBothTips = () => {
    tip.classList.remove('visible');
    document.getElementById('progress-tooltip')?.classList.remove('visible');
  };
  window.addEventListener('scroll', hideBothTips, true);
})();
document.addEventListener('click', e => {
  if (!document.getElementById('ctx-menu').contains(e.target)) closeCtxMenu();
  const ctxPl = document.getElementById('ctx-playlist-menu');
  if (ctxPl && !ctxPl.contains(e.target)) closeCtxPlaylistMenu();
  const qw = document.querySelector('.queue-btn-wrap');
  if (qw && !qw.contains(e.target)) closeQueuePanel();
  const sw = document.getElementById('settings-wrap');
  if (sw && !sw.contains(e.target)) closeSettingsPanel();
  const fp = document.getElementById('file-picker-overlay');
  if (fp && e.target === fp) fpClose();
  const clm = document.getElementById('clear-library-modal');
  if (clm && e.target === clm) closeClearLibraryModal();
  const dpl = document.getElementById('delete-playlist-modal');
  if (dpl && e.target === dpl) closeDeletePlaylistModal();
  const rpl = document.getElementById('remove-from-playlist-modal');
  if (rpl && e.target === rpl) closeRemoveFromPlaylistModal();
  const atp = document.getElementById('add-to-playlist-modal');
  if (atp && e.target === atp) closeAddToPlaylistModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCtxMenu();
    closeCtxPlaylistMenu();
    closeQueuePanel();
    closeSettingsPanel();
    fpClose();
    closeClearLibraryModal();
    closeDeletePlaylistModal();
    closeRemoveFromPlaylistModal();
    closeAddToPlaylistModal();
  }
});
let currentLibraryView = 'library';
let currentPlaylistId = null;
let playlists = [];
let playlistTracks = [];
let _plPhotoDataURL = null;
let _atpTargetTrackIndex = -1;
let playlistSearchQuery = '';
let _ctxPlaylistId = null;
let _plDragSrc = -1;
let _plDragEl = null;
let _plDragActive = false;
let _plDragPending = false;
let _plDragPendingIdx = -1;
let _plDragStartX = 0;
let _plDragStartY = 0;
let _plDragLeftItem = false;
function _generateId() {
  return 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}
async function _plSave(pl) {
  const d = await dbOpen();
  const tx = d.transaction('playlists', 'readwrite');
  await new Promise((res, rej) => {
    const r = tx.objectStore('playlists').put(pl);
    r.onsuccess = res;
    r.onerror = rej;
  });
}
async function _plDelete(id) {
  const d = await dbOpen();
  const tx = d.transaction(['playlists', 'playlistTracks'], 'readwrite');
  tx.objectStore('playlists').delete(id);
  const idx = tx.objectStore('playlistTracks').index('byPlaylist');
  const req = idx.getAll(IDBKeyRange.only(id));
  req.onsuccess = () => {
    for (const pt of req.result) tx.objectStore('playlistTracks').delete(pt.id);
  };
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}
async function _plLoadAll() {
  const d = await dbOpen();
  const tx = d.transaction('playlists', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('playlists').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}
async function _ptSave(pt) {
  const d = await dbOpen();
  const tx = d.transaction('playlistTracks', 'readwrite');
  await new Promise((res, rej) => {
    const r = tx.objectStore('playlistTracks').put(pt);
    r.onsuccess = res;
    r.onerror = rej;
  });
}
async function _ptDelete(id) {
  const d = await dbOpen();
  const tx = d.transaction('playlistTracks', 'readwrite');
  await new Promise((res, rej) => {
    const r = tx.objectStore('playlistTracks').delete(id);
    r.onsuccess = res;
    r.onerror = rej;
  });
}
async function _ptLoadAll() {
  const d = await dbOpen();
  const tx = d.transaction('playlistTracks', 'readonly');
  return new Promise((res, rej) => {
    const r = tx.objectStore('playlistTracks').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}
async function _loadPlaylistData() {
  playlists = await _plLoadAll();
  playlistTracks = await _ptLoadAll();
}
function mainActionClick() {
  if (currentLibraryView === 'library') {
    triggerAddTrack();
  } else {
    openCreatePlaylistModal();
  }
}
function setLibraryView(view) {
  currentLibraryView = view;
  const isLib = view === 'library';
  document.getElementById('nav-library').classList.toggle('active', isLib);
  document.getElementById('nav-playlists').classList.toggle('active', !isLib);
  const libEl = document.getElementById('view-library');
  const plEl = document.getElementById('view-playlists');
  libEl.classList.toggle('hidden', !isLib);
  plEl.classList.toggle('hidden', isLib);
  const animTarget = isLib ? libEl : plEl;
  animTarget.classList.remove('section-enter');
  void animTarget.offsetWidth;
  animTarget.classList.add('section-enter');
  const label = document.getElementById('main-action-label');
  const icon = document.getElementById('main-action-icon');
  const searchInput = document.getElementById('search-input');
  searchQuery = '';
  playlistSearchQuery = '';
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = isLib ? 'Buscar música ou artista…' : 'Buscar playlist ou tag…';
  }
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  if (isLib) {
    label.textContent = 'Adicionar música';
    icon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
    renderList();
  } else {
    label.textContent = 'Criar playlist';
    icon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
    renderPlaylistsView();
  }
}
function renderPlaylistsView() {
  const container = document.getElementById('playlists-container');
  if (!container) return;
  document.getElementById('playlist-list-view').classList.remove('hidden');
  document.getElementById('playlist-detail-view').classList.add('hidden');
  currentPlaylistId = null;
  if (playlists.length === 0) {
    container.innerHTML = `<div class="playlists-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
      <p>Nenhuma playlist ainda.<br>Clique em "Criar playlist" para começar.</p>
    </div>`;
    return;
  }
  const existingCards = container.querySelectorAll('.playlist-card[data-plid]');
  const needsRebuild = existingCards.length !== playlists.length || Array.from(existingCards).some((el, idx) => el.dataset.plid !== playlists[idx].id);
  if (needsRebuild) {
    container.innerHTML = playlists.map(pl => {
      const count = playlistTracks.filter(pt => pt.playlistId === pl.id).length;
      const coverHtml = pl.photo ? `<img src="${pl.photo}" alt="">` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
      return `<div class="playlist-card" data-plid="${escHtml(pl.id)}" onclick="openPlaylistDetail('${escHtml(pl.id)}')" oncontextmenu="openCtxPlaylistMenu(event,'${escHtml(pl.id)}')">
        <div class="playlist-card-cover">${coverHtml}</div>
        <div class="playlist-card-info">
          <div class="playlist-card-name">${escHtml(pl.name)}</div>
          <div class="playlist-card-meta">${count} música${count !== 1 ? 's' : ''}${pl.description ? ' · ' + escHtml(pl.description).slice(0, 30) + (pl.description.length > 30 ? '…' : '') : ''}</div>
        </div>
        <div class="playlist-card-playing-icon"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></div>
      </div>`;
    }).join('') + `<div class="search-no-results" id="pl-no-results" style="display:none;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
      <p id="pl-no-results-text"></p>
    </div>`;
  }
  const q = playlistSearchQuery;
  let visibleCount = 0;
  container.querySelectorAll('.playlist-card[data-plid]').forEach(card => {
    const plId = card.dataset.plid;
    const pl = playlists.find(p => p.id === plId);
    if (!pl) {
      card.style.display = 'none';
      return;
    }
    const matches = !q || pl.name.toLowerCase().includes(q) || (pl.tags || []).some(t => t.toLowerCase().includes(q));
    card.style.display = matches ? '' : 'none';
    if (matches) {
      const nameEl = card.querySelector('.playlist-card-name');
      if (nameEl) nameEl.innerHTML = highlight(pl.name, q);
      const metaEl = card.querySelector('.playlist-card-meta');
      if (metaEl) {
        const count = playlistTracks.filter(pt => pt.playlistId === pl.id).length;
        metaEl.textContent = `${count} música${count !== 1 ? 's' : ''}${pl.description ? ' · ' + pl.description.slice(0, 30) + (pl.description.length > 30 ? '…' : '') : ''}`;
      }
      const coverEl = card.querySelector('.playlist-card-cover');
      if (coverEl) {
        coverEl.innerHTML = pl.photo ? `<img src="${pl.photo}" alt="">` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
      }
      visibleCount++;
    }
  });
  const noResults = document.getElementById('pl-no-results');
  if (noResults) {
    if (visibleCount === 0 && q) {
      document.getElementById('pl-no-results-text').innerHTML = `Nenhuma playlist encontrada para<br><strong>"${escHtml(q)}"</strong>`;
      noResults.style.display = '';
    } else {
      noResults.style.display = 'none';
    }
  }
  _updatePlayingPlaylistCard();
}
function openPlaylistDetail(plId) {
  currentPlaylistId = plId;
  document.getElementById('playlist-list-view').classList.add('hidden');
  const detailEl = document.getElementById('playlist-detail-view');
  detailEl.classList.remove('hidden');
  detailEl.classList.remove('pl-anim-in');
  void detailEl.offsetWidth;
  detailEl.classList.add('pl-anim-in');
  document.getElementById('playlist-sort-select').value = 'order';
  playlistSearchQuery = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = 'Buscar música ou artista…';
  }
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderPlaylistDetail();
  setTimeout(_setupPlCoverZoom, 0);
}
function closePlaylistDetail() {
  currentPlaylistId = null;
  const listEl = document.getElementById('playlist-list-view');
  listEl.classList.remove('hidden');
  listEl.classList.remove('pl-list-anim-in');
  void listEl.offsetWidth;
  listEl.classList.add('pl-list-anim-in');
  document.getElementById('playlist-detail-view').classList.add('hidden');
  const _coverEl = document.getElementById('playlist-detail-cover');
  if (_coverEl && _coverEl._zoomCleanup) {
    _coverEl._zoomCleanup();
    _coverEl._zoomCleanup = null;
  }
  const _plZoom = document.getElementById('pl-cover-zoom-preview');
  if (_plZoom) _plZoom.classList.remove('visible');
  playlistSearchQuery = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = 'Buscar playlist ou tag…';
  }
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderPlaylistsView();
}
function renderPlaylistDetail() {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl) return;
  const coverEl = document.getElementById('playlist-detail-cover');
  coverEl.innerHTML = pl.photo ? `<img src="${pl.photo}" alt="">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
  document.getElementById('playlist-detail-name').textContent = pl.name;
  document.getElementById('playlist-detail-desc').textContent = pl.description || '';
  const tagsEl = document.getElementById('playlist-detail-tags');
  tagsEl.innerHTML = (pl.tags || []).filter(Boolean).map(t => `<span class="playlist-tag-chip">${escHtml(t)}</span>`).join('');
  renderPlaylistTracks();
}
function _getSortedPlaylistTracks() {
  const sort = document.getElementById('playlist-sort-select')?.value || 'order';
  let pts = playlistTracks.filter(pt => pt.playlistId === currentPlaylistId);
  if (sort === 'alpha') {
    pts = pts.slice().sort((a, b) => {
      const ta = tracks.find(t => t.id === a.trackId);
      const tb = tracks.find(t => t.id === b.trackId);
      return (ta?.name || '').localeCompare(tb?.name || '');
    });
  } else if (sort === 'added_desc') {
    pts = pts.slice().sort((a, b) => b.addedAt - a.addedAt);
  } else if (sort === 'added_asc') {
    pts = pts.slice().sort((a, b) => a.addedAt - b.addedAt);
  } else {
    pts = pts.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  return pts;
}
function renderPlaylistTracks() {
  const listEl = document.getElementById('playlist-tracks-list');
  if (!listEl) return;
  let pts = _getSortedPlaylistTracks();
  if (playlistSearchQuery) {
    pts = pts.filter(pt => {
      const t = tracks.find(tr => tr.id === pt.trackId);
      if (!t) return false;
      return t.name.toLowerCase().includes(playlistSearchQuery) || t.artist.toLowerCase().includes(playlistSearchQuery);
    });
  }
  if (pts.length === 0) {
    if (playlistSearchQuery) {
      listEl.innerHTML = `<div class="search-no-results">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
        <p>Nenhum resultado para<br><strong>"${escHtml(playlistSearchQuery)}"</strong></p>
      </div>`;
    } else {
      listEl.innerHTML = `<div class="playlist-tracks-empty">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        <p>Nenhuma música nesta playlist.<br>Clique direito em uma música para adicionar.</p>
      </div>`;
    }
    return;
  }
  listEl.innerHTML = pts.map((pt, vi) => {
    const t = tracks.find(tr => tr.id === pt.trackId);
    if (!t) return '';
    const isActive = currentIndex >= 0 && tracks[currentIndex]?.id === t.id;
    const coverHtml = t.coverUrl || t.cover ? `<img class="track-cover" src="${t.coverUrl || t.cover}" alt="">` : `<div class="track-cover-placeholder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`;
    return `<div class="pl-track-item${isActive ? ' active' : ''}" data-ptid="${escHtml(pt.id)}" data-vi="${vi}" onmousedown="plTrackMouseDown(event,'${escHtml(pt.id)}',${vi})" onclick="selectTrackById('${escHtml(t.id)}')" oncontextmenu="openCtxPlaylistTrackMenu(event,'${escHtml(pt.id)}')">
      <div class="pl-track-drag-handle" onmousedown="plDragHandleDown(event,'${escHtml(pt.id)}',${vi})" onclick="event.stopPropagation()">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
      </div>
      ${coverHtml}
      <div class="track-info">
        <div class="track-name">${highlight(t.name, playlistSearchQuery)}</div>
        <div class="track-artist">${highlight(formatArtist(t.artist), playlistSearchQuery)}</div>
      </div>
      <button class="pl-track-remove" onclick="requestRemoveTrackFromPlaylist(event,'${escHtml(pt.id)}','${escHtml(t.name)}')" data-tip="Remover da playlist">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');
}
function applyPlaylistSort() {
  renderPlaylistTracks();
}
let _playlistContext = null;
function _updatePlayingPlaylistCard() {
  const cards = document.querySelectorAll('#playlists-container .playlist-card[data-plid]');
  cards.forEach(card => {
    const plid = card.dataset.plid;
    const isActive = _playlistContext && plid === _playlistContext;
    card.classList.toggle('is-playing', !!(isActive && isPlaying));
    card.classList.toggle('is-paused', !!(isActive && !isPlaying));
  });
}
function selectTrackById(trackId) {
  const idx = tracks.findIndex(t => t.id === trackId);
  if (idx < 0) return;
  _playlistContext = currentPlaylistId || null;
  selectTrack(idx, false, true);
}
function _getPlaylistTrackIds() {
  if (!_playlistContext) return null;
  const pts = playlistTracks.filter(pt => pt.playlistId === _playlistContext).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  return pts.map(pt => pt.trackId);
}
function openCreatePlaylistModal() {
  _plPhotoDataURL = null;
  document.getElementById('pl-name').value = '';
  document.getElementById('pl-desc').value = '';
  document.getElementById('pl-tag-1').value = '';
  document.getElementById('pl-tag-2').value = '';
  document.getElementById('pl-tag-3').value = '';
  document.getElementById('pl-photo-preview').innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  const _cpm = document.getElementById('create-playlist-modal');
  _cpm.classList.remove('hidden');
  if (!_cpm._backdropHandler) {
    _cpm._backdropHandler = function (e) {
      if (e.target === _cpm) closeCreatePlaylistModal();
    };
    _cpm.addEventListener('mousedown', _cpm._backdropHandler);
  }
  setTimeout(() => document.getElementById('pl-name').focus(), 100);
}
function closeCreatePlaylistModal() {
  const modal = document.getElementById('create-playlist-modal');
  if (modal.classList.contains('hidden') || modal.classList.contains('modal--closing')) return;
  modal.classList.add('modal--closing');
  setTimeout(() => {
    modal.classList.remove('modal--closing');
    modal.classList.add('hidden');
    _plPhotoDataURL = null;
  }, 180);
}
function plPhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    _plPhotoDataURL = ev.target.result;
    const preview = document.getElementById('pl-photo-preview');
    preview.innerHTML = `<img src="${_plPhotoDataURL}" alt="">`;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}
function plTagInput(n) {}
async function confirmCreatePlaylist() {
  const name = document.getElementById('pl-name').value.trim();
  if (!name) {
    document.getElementById('pl-name').classList.add('input-error');
    document.getElementById('pl-name').placeholder = 'Nome obrigatório';
    document.getElementById('pl-name').focus();
    setTimeout(() => document.getElementById('pl-name').classList.remove('input-error'), 2000);
    return;
  }
  const tags = [document.getElementById('pl-tag-1').value.trim(), document.getElementById('pl-tag-2').value.trim(), document.getElementById('pl-tag-3').value.trim()].filter(Boolean);
  const pl = {
    id: _generateId(),
    name,
    description: document.getElementById('pl-desc').value.trim(),
    photo: _plPhotoDataURL || null,
    tags,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  try {
    await _plSave(pl);
    playlists.push(pl);
    closeCreatePlaylistModal();
    renderPlaylistsView();
    toast(`Playlist "${name}" criada!`);
  } catch (e) {
    toast('Erro ao criar playlist.');
  }
}
function ctxAddToPlaylist() {
  if (ctxTargetIndex < 0) return;
  _atpTargetTrackIndex = ctxTargetIndex;
  closeCtxMenu();
  if (playlists.length === 0) {
    toast('Você ainda não tem nenhuma playlist criada.');
    return;
  }
  openAddToPlaylistModal();
}
function openAddToPlaylistModal() {
  const listEl = document.getElementById('add-to-playlist-list');
  const t = tracks[_atpTargetTrackIndex];
  if (!t) return;
  listEl.innerHTML = playlists.map(pl => {
    const coverHtml = pl.photo ? `<div class="atp-cover"><img src="${pl.photo}" alt=""></div>` : `<div class="atp-cover"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/></svg></div>`;
    return `<div class="atp-item">
      ${coverHtml}
      <span class="atp-name">${escHtml(pl.name)}</span>
      <button class="atp-add-btn" onclick="addTrackToPlaylist('${escHtml(pl.id)}')">+</button>
    </div>`;
  }).join('');
  document.getElementById('add-to-playlist-modal').classList.remove('hidden');
}
function closeAddToPlaylistModal() {
  const modal = document.getElementById('add-to-playlist-modal');
  if (modal.classList.contains('hidden') || modal.classList.contains('modal--closing')) return;
  modal.classList.add('modal--closing');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('modal--closing');
    _atpTargetTrackIndex = -1;
  }, 185);
}
async function addTrackToPlaylist(plId) {
  const t = tracks[_atpTargetTrackIndex];
  if (!t) return;
  const exists = playlistTracks.find(pt => pt.playlistId === plId && pt.trackId === t.id);
  if (exists) {
    const pl = playlists.find(p => p.id === plId);
    toast(`"${t.name}" já está adicionada em "${pl?.name}".`);
    closeAddToPlaylistModal();
    return;
  }
  const maxOrder = playlistTracks.filter(pt => pt.playlistId === plId).reduce((m, pt) => Math.max(m, pt.order || 0), -1);
  const pt = {
    id: _generateId(),
    playlistId: plId,
    trackId: t.id,
    addedAt: Date.now(),
    order: maxOrder + 1
  };
  try {
    await _ptSave(pt);
    playlistTracks.push(pt);
    const pl = playlists.find(p => p.id === plId);
    toast(`"${t.name}" adicionada a "${pl?.name}"!`);
    closeAddToPlaylistModal();
    if (currentPlaylistId === plId) renderPlaylistTracks();
  } catch (e) {
    toast('Erro ao adicionar música.');
  }
}
let _removeFromPlaylistPtId = null;
let _removeFromPlaylistCallback = null;
function requestRemoveTrackFromPlaylist(e, ptId, trackName) {
  e.stopPropagation();
  _removeFromPlaylistPtId = ptId;
  const msg = document.getElementById('remove-from-playlist-msg');
  if (msg) msg.innerHTML = `Remover <strong>"${escHtml(trackName)}"</strong> desta playlist?`;
  const yesBtn = document.getElementById('remove-from-playlist-yes-btn');
  if (yesBtn) yesBtn.onclick = () => {
    confirmRemoveTrackFromPlaylist();
  };
  const modal = document.getElementById('remove-from-playlist-modal');
  if (modal) modal.classList.remove('hidden');
}
function closeRemoveFromPlaylistModal() {
  _removeFromPlaylistPtId = null;
  const modal = document.getElementById('remove-from-playlist-modal');
  if (modal) modal.classList.add('hidden');
}
async function confirmRemoveTrackFromPlaylist() {
  const ptId = _removeFromPlaylistPtId;
  closeRemoveFromPlaylistModal();
  if (!ptId) return;
  const idx = playlistTracks.findIndex(pt => pt.id === ptId);
  if (idx < 0) return;
  try {
    await _ptDelete(ptId);
    playlistTracks.splice(idx, 1);
    renderPlaylistTracks();
    toast('Música removida da playlist.');
  } catch (err) {
    toast('Erro ao remover música.');
  }
}
async function removeTrackFromPlaylist(e, ptId) {
  if (e && e.stopPropagation) e.stopPropagation();
  const idx = playlistTracks.findIndex(pt => pt.id === ptId);
  if (idx < 0) return;
  try {
    await _ptDelete(ptId);
    playlistTracks.splice(idx, 1);
    renderPlaylistTracks();
  } catch (err) {
    toast('Erro ao remover música.');
  }
}
function openCtxPlaylistMenu(e, plId) {
  e.preventDefault();
  e.stopPropagation();
  _ctxPlaylistId = plId;
  const menu = document.getElementById('ctx-playlist-menu');
  menu.classList.add('visible');
  _positionCtxMenu(menu, e.clientX, e.clientY);
}
function closeCtxPlaylistMenu() {
  const menu = document.getElementById('ctx-playlist-menu');
  if (menu) menu.classList.remove('visible');
  _ctxPlaylistId = null;
}
let _plEditPhotoDataURL = undefined;
let _editingPlaylistId = null;
function ctxEditPlaylist() {
  const plId = _ctxPlaylistId;
  closeCtxPlaylistMenu();
  if (!plId) return;
  openEditPlaylistModal(plId);
}
function openEditPlaylistModal(plId) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  _editingPlaylistId = plId;
  _plEditPhotoDataURL = undefined;
  document.getElementById('pl-edit-name').value = pl.name || '';
  document.getElementById('pl-edit-desc').value = pl.description || '';
  const tags = pl.tags || [];
  document.getElementById('pl-edit-tag-1').value = tags[0] || '';
  document.getElementById('pl-edit-tag-2').value = tags[1] || '';
  document.getElementById('pl-edit-tag-3').value = tags[2] || '';
  const preview = document.getElementById('pl-edit-photo-preview');
  preview.innerHTML = pl.photo ? `<img src="${pl.photo}" alt="">` : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  document.getElementById('edit-playlist-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('pl-edit-name').focus(), 100);
  plCharInput('pl-edit-name', 'pl-edit-name-counter', 60);
  plCharInput('pl-edit-desc', 'pl-edit-desc-counter', 30);
  [1, 2, 3].forEach(n => plCharInput('pl-edit-tag-' + n, 'pl-edit-tag-counter-' + n, 25));
}
function closeEditPlaylistModal() {
  const modal = document.getElementById('edit-playlist-modal');
  if (modal.classList.contains('hidden') || modal.classList.contains('modal--closing')) return;
  modal.classList.add('modal--closing');
  setTimeout(() => {
    modal.classList.remove('modal--closing');
    modal.classList.add('hidden');
    _plEditPhotoDataURL = undefined;
    _editingPlaylistId = null;
  }, 180);
}
document.getElementById('edit-playlist-modal').addEventListener('mousedown', function (e) {
  if (e.target === this) closeEditPlaylistModal();
});
function plEditPhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    _plEditPhotoDataURL = ev.target.result;
    const preview = document.getElementById('pl-edit-photo-preview');
    preview.innerHTML = `<img src="${_plEditPhotoDataURL}" alt="">`;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}
async function confirmEditPlaylist() {
  const plId = _editingPlaylistId;
  if (!plId) return;
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  const name = document.getElementById('pl-edit-name').value.trim();
  if (!name) {
    const inp = document.getElementById('pl-edit-name');
    inp.classList.add('input-error');
    inp.placeholder = 'Nome obrigatório';
    inp.focus();
    setTimeout(() => inp.classList.remove('input-error'), 2000);
    return;
  }
  const tags = [document.getElementById('pl-edit-tag-1').value.trim(), document.getElementById('pl-edit-tag-2').value.trim(), document.getElementById('pl-edit-tag-3').value.trim()].filter(Boolean);
  pl.name = name;
  pl.description = document.getElementById('pl-edit-desc').value.trim();
  pl.tags = tags;
  if (_plEditPhotoDataURL !== undefined) pl.photo = _plEditPhotoDataURL;
  pl.updatedAt = Date.now();
  try {
    await _plSave(pl);
    closeEditPlaylistModal();
    renderPlaylistsView();
    if (currentPlaylistId === plId) renderPlaylistDetail();
    toast(`Playlist "${name}" atualizada!`);
  } catch (e) {
    toast('Erro ao salvar playlist.');
  }
}
function ctxDeletePlaylist() {
  const plId = _ctxPlaylistId;
  closeCtxPlaylistMenu();
  if (!plId) return;
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  const msg = document.getElementById('delete-playlist-msg');
  if (msg) msg.innerHTML = `Tem certeza que deseja deletar a playlist <strong>"${escHtml(pl.name)}"</strong>? Esta ação não pode ser desfeita.`;
  const yesBtn = document.getElementById('delete-playlist-yes-btn');
  if (yesBtn) yesBtn.onclick = () => confirmDeletePlaylist(plId);
  const modal = document.getElementById('delete-playlist-modal');
  if (modal) modal.classList.remove('hidden');
}
function closeDeletePlaylistModal() {
  const modal = document.getElementById('delete-playlist-modal');
  if (!modal || modal.classList.contains('hidden') || modal.classList.contains('modal--closing')) return;
  modal.classList.add('modal--closing');
  setTimeout(() => {
    modal.classList.remove('modal--closing');
    modal.classList.add('hidden');
  }, 180);
}
async function confirmDeletePlaylist(plId) {
  closeDeletePlaylistModal();
  try {
    await _plDelete(plId);
    const idx = playlists.findIndex(p => p.id === plId);
    if (idx >= 0) playlists.splice(idx, 1);
    const before = playlistTracks.length;
    playlistTracks = playlistTracks.filter(pt => pt.playlistId !== plId);
    renderPlaylistsView();
    toast('Playlist deletada.');
  } catch (e) {
    toast('Erro ao deletar playlist.');
  }
}
let _ctxPlaylistTrackPtId = null;
function openCtxPlaylistTrackMenu(e, ptId) {
  e.preventDefault();
  e.stopPropagation();
  const pt = playlistTracks.find(p => p.id === ptId);
  if (!pt) return;
  const trackIdx = tracks.findIndex(t => t.id === pt.trackId);
  if (trackIdx < 0) return;
  _ctxPlaylistTrackPtId = ptId;
  ctxTargetIndex = trackIdx;
  const menu = document.getElementById('ctx-menu');
  const items = menu.querySelectorAll('.ctx-item, .ctx-sep');
  menu.dataset.playlistMode = '1';
  menu.classList.add('visible');
  _positionCtxMenu(menu, e.clientX, e.clientY);
  _applyCtxMenuPlaylistMode(true);
}
function _applyCtxMenuPlaylistMode(isPlaylist) {
  const menu = document.getElementById('ctx-menu');
  const allItems = menu.children;
  for (let i = 0; i < allItems.length; i++) {
    const el = allItems[i];
    if (isPlaylist) {
      el.style.display = i < 2 ? '' : 'none';
    } else {
      el.style.display = '';
    }
  }
  if (!isPlaylist) {
    const t = tracks[ctxTargetIndex];
    const isNoData = t && t.noData;
    const addDataItem = document.getElementById('ctx-item-adddata');
    const addDataSep = document.getElementById('ctx-sep-adddata');
    if (addDataItem) addDataItem.style.display = isNoData ? '' : 'none';
    if (addDataSep) addDataSep.style.display = isNoData ? '' : 'none';
  }
}
function showBottomTooltip(msg) {
  let tip = document.getElementById('bottom-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'bottom-tooltip';
    tip.className = 'tooltip';
    document.body.appendChild(tip);
  }
  tip.textContent = msg;
  tip.classList.add('show');
  clearTimeout(tip._timer);
  tip._timer = setTimeout(() => tip.classList.remove('show'), 3000);
}
function plDragHandleDown(e, ptId, vi) {
  e.preventDefault();
  e.stopPropagation();
  _plDragPending = false;
  _plInitDrag(ptId, vi);
  document.addEventListener('mousemove', _onPlDragMove);
  document.addEventListener('mouseup', _onPlDragUp);
}
function plTrackMouseDown(e, ptId, vi) {
  if (e.target.closest('.pl-track-drag-handle')) return;
  if (e.button !== 0) return;
  _plDragPending = true;
  _plDragPendingIdx = vi;
  _plDragStartX = e.clientX;
  _plDragStartY = e.clientY;
  _plDragLeftItem = false;
  document.addEventListener('mousemove', _onPlPendingMove);
  document.addEventListener('mouseup', _onPlPendingUp);
}
function _onPlPendingMove(e) {
  if (!_plDragPending) return;
  const dx = Math.abs(e.clientX - _plDragStartX);
  const dy = Math.abs(e.clientY - _plDragStartY);
  if (dx > 5 || dy > 5) {
    _plDragLeftItem = true;
    _plDragPending = false;
    document.removeEventListener('mousemove', _onPlPendingMove);
    document.removeEventListener('mouseup', _onPlPendingUp);
    const el = document.querySelector(`#playlist-tracks-list .pl-track-item[data-vi="${_plDragPendingIdx}"]`);
    if (el) {
      const ptId = el.dataset.ptid;
      _plInitDrag(ptId, _plDragPendingIdx);
    }
    document.addEventListener('mousemove', _onPlDragMove);
    document.addEventListener('mouseup', _onPlDragUp);
  }
}
function _onPlPendingUp(e) {
  _plDragPending = false;
  document.removeEventListener('mousemove', _onPlPendingMove);
  document.removeEventListener('mouseup', _onPlPendingUp);
}
function _plInitDrag(ptId, vi) {
  _plDragSrc = vi;
  _plDragEl = document.querySelector(`#playlist-tracks-list .pl-track-item[data-ptid="${ptId}"]`);
  if (_plDragEl) _plDragEl.classList.add('pl-dragging');
  _plDragActive = true;
}
function _plGetItemAtY(clientY) {
  const items = document.querySelectorAll('#playlist-tracks-list .pl-track-item[data-vi]');
  for (const el of items) {
    const rect = el.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) return el;
  }
  return null;
}
function _onPlDragMove(e) {
  if (!_plDragActive) return;
  document.querySelectorAll('.pl-drag-over-top,.pl-drag-over-bottom').forEach(el => el.classList.remove('pl-drag-over-top', 'pl-drag-over-bottom'));
  const target = _plGetItemAtY(e.clientY);
  if (!target) return;
  const vi = parseInt(target.dataset.vi);
  if (vi === _plDragSrc) return;
  const rect = target.getBoundingClientRect();
  target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'pl-drag-over-top' : 'pl-drag-over-bottom');
}
function _onPlDragUp(e) {
  if (!_plDragActive) return;
  _plDragActive = false;
  document.removeEventListener('mousemove', _onPlDragMove);
  document.removeEventListener('mouseup', _onPlDragUp);
  if (_plDragEl) _plDragEl.classList.remove('pl-dragging');
  _plDragEl = null;
  document.querySelectorAll('.pl-drag-over-top,.pl-drag-over-bottom').forEach(el => el.classList.remove('pl-drag-over-top', 'pl-drag-over-bottom'));
  const suppress = ev => {
    ev.stopImmediatePropagation();
    ev.preventDefault();
  };
  document.addEventListener('click', suppress, {
    capture: true,
    once: true
  });
  if (_plDragSrc < 0) return;
  const target = _plGetItemAtY(e.clientY);
  if (!target) {
    _plDragSrc = -1;
    return;
  }
  const vi = parseInt(target.dataset.vi);
  if (vi === _plDragSrc) {
    _plDragSrc = -1;
    return;
  }
  const rect = target.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  const pts = _getSortedPlaylistTracks();
  const moved = pts.splice(_plDragSrc, 1)[0];
  let insertAt = vi;
  if (_plDragSrc < vi) insertAt = vi - 1;
  if (!before) insertAt += 1;
  pts.splice(insertAt, 0, moved);
  pts.forEach((pt, idx) => {
    pt.order = idx;
    _ptSave(pt).catch(() => {});
  });
  pts.forEach(pt => {
    const mem = playlistTracks.find(p => p.id === pt.id);
    if (mem) mem.order = pt.order;
  });
  _plDragSrc = -1;
  renderPlaylistTracks();
}
init();
window._restoreCursor = null;
(function () {
  const cur = 'url("cursor/cursor.png") 2 2, none';
  function applyToAll() {
    document.querySelectorAll('*').forEach(el => el.style.setProperty('cursor', cur, 'important'));
  }
  applyToAll();
  const observer = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.style) n.style.setProperty('cursor', cur, 'important');
      if (n.querySelectorAll) n.querySelectorAll('*').forEach(el => {
        el.style.setProperty('cursor', cur, 'important');
      });
    }));
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  window._restoreCursor = applyToAll;
})();
document.addEventListener('contextmenu', e => {
  if (e.target.closest('.track-item[data-index]')) return;
  if (e.target.closest('.playlist-card')) return;
  if (e.target.closest('.pl-track-item[data-ptid]')) return;
  if (e.target.closest('.stats-track-item[oncontextmenu]')) return;
  e.preventDefault();
});
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());
document.addEventListener('dragover', e => e.preventDefault());
const STATS_TRACKS_STORE = 'statsTrack';
const STATS_PLAYLISTS_STORE = 'statsPl';
const _origDbOpen = dbOpen;
async function dbOpen() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('player_db', 3);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', {
        keyPath: 'id'
      });
      if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', {
        keyPath: 'id'
      });
      if (!d.objectStoreNames.contains('playlistTracks')) {
        const pts = d.createObjectStore('playlistTracks', {
          keyPath: 'id'
        });
        pts.createIndex('byPlaylist', 'playlistId');
      }
      if (!d.objectStoreNames.contains(STATS_TRACKS_STORE)) d.createObjectStore(STATS_TRACKS_STORE, {
        keyPath: 'id'
      });
      if (!d.objectStoreNames.contains(STATS_PLAYLISTS_STORE)) d.createObjectStore(STATS_PLAYLISTS_STORE, {
        keyPath: 'id'
      });
    };
    req.onsuccess = e => {
      db = e.target.result;
      db.onclose = () => {
        db = null;
      };
      resolve(db);
    };
    req.onerror = e => reject(e.target.error);
  });
}
function _getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 6 ? 6 : day;
  const d = new Date(now);
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function _getMonthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function _getYearStart() {
  return new Date(new Date().getFullYear(), 0, 1).getTime();
}
async function _statsTrackGet(trackId) {
  const d = await dbOpen();
  const tx = d.transaction(STATS_TRACKS_STORE, 'readonly');
  return new Promise(res => {
    const r = tx.objectStore(STATS_TRACKS_STORE).get(trackId);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  });
}
async function _statsTrackPut(rec) {
  const d = await dbOpen();
  const tx = d.transaction(STATS_TRACKS_STORE, 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore(STATS_TRACKS_STORE).put(rec);
    r.onsuccess = res;
    r.onerror = rej;
  });
}
async function _statsTrackGetAll() {
  const d = await dbOpen();
  const tx = d.transaction(STATS_TRACKS_STORE, 'readonly');
  return new Promise(res => {
    const r = tx.objectStore(STATS_TRACKS_STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}
async function _statsTrackDelete(trackId) {
  const d = await dbOpen();
  const tx = d.transaction(STATS_TRACKS_STORE, 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore(STATS_TRACKS_STORE).delete(trackId);
    r.onsuccess = res;
    r.onerror = rej;
  });
}
async function statsIncrementTrack(track) {
  if (!track) return;
  const weekStart = _getWeekStart();
  const monthStart = _getMonthStart();
  const yearStart = _getYearStart();
  const now = Date.now();
  const displayName = track.name || track.fileName || 'Desconhecida';
  const displayArtist = track.artist || '';
  let rec = await _statsTrackGet(track.id);
  if (!rec) {
    rec = {
      id: track.id,
      name: displayName,
      artist: displayArtist,
      cover: track.cover || track.coverUrl || null,
      spotifyUrl: track.spotifyUrl || null,
      albumId: track.albumId || null,
      albumName: track.albumName || null,
      albumArtists: track.albumArtists || null,
      albumArtistSignatureCounts: {},
      countTotal: 0,
      weekPlays: [],
      monthPlays: [],
      yearPlays: [],
      lastPlay: 0
    };
  }
  rec.name = track.name || track.fileName || rec.name;
  rec.artist = track.artist || rec.artist;
  rec.cover = track.cover || track.coverUrl || rec.cover;
  rec.albumId = track.albumId || rec.albumId;
  rec.albumName = track.albumName || rec.albumName;
  rec.spotifyUrl = track.spotifyUrl || rec.spotifyUrl;
  if (track.albumArtists && Array.isArray(track.albumArtists) && track.albumArtists.length > 0) {
    rec.albumArtists = track.albumArtists;
  }
  const _sigSource = track.albumArtists && Array.isArray(track.albumArtists) && track.albumArtists.length > 0 ? track.albumArtists : rec.albumArtists && Array.isArray(rec.albumArtists) ? rec.albumArtists : null;
  if (_sigSource && _sigSource.length > 0) {
    const _sig = _sigSource.map(n => (n || '').toLowerCase().trim()).sort().join('|');
    if (_sig) {
      if (!rec.albumArtistSignatureCounts) rec.albumArtistSignatureCounts = {};
      rec.albumArtistSignatureCounts[_sig] = (rec.albumArtistSignatureCounts[_sig] || 0) + 1;
    }
  }
  rec.countTotal++;
  rec.lastPlay = now;
  rec.weekPlays = (rec.weekPlays || []).filter(t => t >= weekStart);
  rec.weekPlays.push(now);
  rec.monthPlays = (rec.monthPlays || []).filter(t => t >= monthStart);
  rec.monthPlays.push(now);
  rec.yearPlays = (rec.yearPlays || []).filter(t => t >= yearStart);
  rec.yearPlays.push(now);
  await _statsTrackPut(rec);
}
async function _statsPlGet(plId) {
  const d = await dbOpen();
  const tx = d.transaction(STATS_PLAYLISTS_STORE, 'readonly');
  return new Promise(res => {
    const r = tx.objectStore(STATS_PLAYLISTS_STORE).get(plId);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  });
}
async function _statsPlPut(rec) {
  const d = await dbOpen();
  const tx = d.transaction(STATS_PLAYLISTS_STORE, 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore(STATS_PLAYLISTS_STORE).put(rec);
    r.onsuccess = res;
    r.onerror = rej;
  });
}
async function _statsPlGetAll() {
  const d = await dbOpen();
  const tx = d.transaction(STATS_PLAYLISTS_STORE, 'readonly');
  return new Promise(res => {
    const r = tx.objectStore(STATS_PLAYLISTS_STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}
async function _statsPlDelete(plId) {
  const d = await dbOpen();
  const tx = d.transaction(STATS_PLAYLISTS_STORE, 'readwrite');
  return new Promise((res, rej) => {
    const r = tx.objectStore(STATS_PLAYLISTS_STORE).delete(plId);
    r.onsuccess = res;
    r.onerror = rej;
  });
}
async function statsIncrementPlaylist(plId) {
  if (!plId) return;
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  const weekStart = _getWeekStart();
  const monthStart = _getMonthStart();
  const yearStart = _getYearStart();
  const now = Date.now();
  let rec = await _statsPlGet(plId);
  if (!rec) {
    rec = {
      id: plId,
      name: pl.name,
      photo: pl.photo || null,
      countTotal: 0,
      weekPlays: [],
      monthPlays: [],
      yearPlays: [],
      lastPlay: 0
    };
  }
  rec.name = pl.name;
  rec.photo = pl.photo || rec.photo;
  rec.countTotal++;
  rec.lastPlay = now;
  rec.weekPlays = (rec.weekPlays || []).filter(t => t >= weekStart);
  rec.weekPlays.push(now);
  rec.monthPlays = (rec.monthPlays || []).filter(t => t >= monthStart);
  rec.monthPlays.push(now);
  rec.yearPlays = (rec.yearPlays || []).filter(t => t >= yearStart);
  rec.yearPlays.push(now);
  await _statsPlPut(rec);
}
let _statsCurrentTab = 'tracks';
let _chartPeriod = 'week';
let _chartSize = 3;
function _refreshStatsIfOpen() {
  const modal = document.getElementById('stats-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  renderStatsTab(_statsCurrentTab);
}
function openStatsModal() {
  document.getElementById('stats-modal').classList.remove('hidden');
  document.getElementById('btn-stats').classList.add('active');
  renderStatsTab(_statsCurrentTab);
}
function closeStatsModal() {
  const modal = document.getElementById('stats-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('modal--closing');
  modal.addEventListener('animationend', function _once() {
    modal.removeEventListener('animationend', _once);
    modal.classList.remove('modal--closing');
    modal.classList.add('hidden');
  }, {
    once: true
  });
  document.getElementById('btn-stats').classList.remove('active');
  const zp = document.getElementById('chart-zoom-preview');
  if (zp) zp.classList.remove('visible');
}
document.getElementById('stats-modal').addEventListener('click', function (e) {
  if (e.target === this) closeStatsModal();
});
function switchStatsTab(tab) {
  _statsCurrentTab = tab;
  document.querySelectorAll('.stats-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('stats-tab-' + tab).classList.add('active');
  document.querySelectorAll('.stats-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('stats-panel-' + tab).classList.add('active');
  renderStatsTab(tab);
}
function renderStatsTab(tab) {
  if (tab === 'tracks') renderStatsTracks();
  if (tab === 'playlists') renderStatsPlaylists();
  if (tab === 'charts') renderStatsCharts();
}
async function renderStatsTracks() {
  const allRecs = await _statsTrackGetAll();
  const libraryIds = new Set(tracks.map(t => t.id));
  const alltime = [...allRecs].sort((a, b) => b.countTotal - a.countTotal).slice(0, 10);
  const weekStart = _getWeekStart();
  const week = [...allRecs].map(r => ({
    ...r,
    wCount: (r.weekPlays || []).filter(t => t >= weekStart).length
  })).filter(r => r.wCount > 0).sort((a, b) => b.wCount - a.wCount).slice(0, 10);
  _renderTrackList('stats-alltime-tracks', alltime, r => r.countTotal, libraryIds);
  _renderTrackList('stats-week-tracks', week, r => r.wCount, libraryIds);
}
function _renderTrackList(containerId, recs, countFn, libraryIds) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (recs.length === 0) {
    el.innerHTML = `<div class="stats-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><p>Sem estatísticas disponíveis.</p></div>`;
    return;
  }
  el.innerHTML = recs.map((r, idx) => {
    const inLib = libraryIds.has(r.id);
    const coverHtml = r.cover ? `<img class="stats-cover" src="${escHtml(r.cover)}" alt="">` : `<div class="stats-cover-ph"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`;
    const count = countFn(r);
    const ctxAttr = !inLib ? `oncontextmenu="openStatsTrackCtxMenu(event,'${escHtml(r.id)}')"` : '';
    const deletedClass = !inLib ? ' stats-item-deleted' : '';
    const artistHtml = r.artist ? `<div class="stats-artist">${escHtml(r.artist)}</div>` : `<div class="stats-artist" style="font-style:italic;opacity:0.5;">Sem metadados</div>`;
    return `<div class="stats-track-item${deletedClass}" ${ctxAttr}>
      <span class="stats-rank">${idx + 1}</span>
      ${coverHtml}
      <div class="stats-info">
        <div class="stats-name">${escHtml(r.name || 'Desconhecida')}</div>
        ${artistHtml}
      </div>
      <span class="stats-count">${count} play${count !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
}
async function statsRemoveTrack(trackId) {
  await _statsTrackDelete(trackId);
  renderStatsTracks();
  toast('Removida das estatísticas.');
}
async function renderStatsPlaylists() {
  const allRecs = await _statsPlGetAll();
  const libraryPlIds = new Set(playlists.map(p => p.id));
  const alltime = [...allRecs].sort((a, b) => b.countTotal - a.countTotal);
  const weekStart = _getWeekStart();
  const week = [...allRecs].map(r => ({
    ...r,
    wCount: (r.weekPlays || []).filter(t => t >= weekStart).length
  })).filter(r => r.wCount > 0).sort((a, b) => b.wCount - a.wCount).slice(0, 10);
  _renderPlaylistList('stats-alltime-playlists', alltime, r => r.countTotal, libraryPlIds);
  _renderPlaylistList('stats-week-playlists', week, r => r.wCount, libraryPlIds);
}
function _renderPlaylistList(containerId, recs, countFn, libraryPlIds) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (recs.length === 0) {
    el.innerHTML = `<div class="stats-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg><p>Sem estatísticas de playlists disponíveis.</p></div>`;
    return;
  }
  el.innerHTML = recs.map((r, idx) => {
    const inLib = libraryPlIds.has(r.id);
    const coverHtml = r.photo ? `<img class="stats-cover" src="${escHtml(r.photo)}" alt="">` : `<div class="stats-cover-ph"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg></div>`;
    const count = countFn(r);
    const ctxAttr = !inLib ? `oncontextmenu="openStatsPlCtxMenu(event,'${escHtml(r.id)}')"` : '';
    const deletedClass = !inLib ? ' stats-item-deleted' : '';
    return `<div class="stats-track-item${deletedClass}" ${ctxAttr}>
      <span class="stats-rank">${idx + 1}</span>
      ${coverHtml}
      <div class="stats-info">
        <div class="stats-name">${escHtml(r.name)}</div>
        <div class="stats-artist">Playlist</div>
      </div>
      <span class="stats-count">${count} play${count !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
}
async function statsRemovePlaylist(plId) {
  await _statsPlDelete(plId);
  renderStatsPlaylists();
  toast('Playlist removida das estatísticas.');
}
let _statsCtxTrackId = null;
let _statsCtxPlId = null;
function openStatsTrackCtxMenu(e, trackId) {
  e.preventDefault();
  e.stopPropagation();
  _statsCtxTrackId = trackId;
  closeStatsCtxMenus(false);
  const menu = document.getElementById('stats-ctx-menu');
  if (!menu) return;
  menu.classList.add('visible');
  _positionCtxMenu(menu, e.clientX, e.clientY);
}
function openStatsPlCtxMenu(e, plId) {
  e.preventDefault();
  e.stopPropagation();
  _statsCtxPlId = plId;
  closeStatsCtxMenus(false);
  const menu = document.getElementById('stats-pl-ctx-menu');
  if (!menu) return;
  menu.classList.add('visible');
  _positionCtxMenu(menu, e.clientX, e.clientY);
}
function closeStatsCtxMenus(clearIds = true) {
  const m1 = document.getElementById('stats-ctx-menu');
  const m2 = document.getElementById('stats-pl-ctx-menu');
  if (m1) m1.classList.remove('visible');
  if (m2) m2.classList.remove('visible');
  if (clearIds) {
    _statsCtxTrackId = null;
    _statsCtxPlId = null;
  }
}
function statsCtxRemoveTrack() {
  if (!_statsCtxTrackId) return;
  closeStatsCtxMenus(false);
  const modal = document.getElementById('stats-remove-modal');
  const msg = document.getElementById('stats-remove-modal-msg');
  const btn = document.getElementById('stats-remove-modal-confirm-btn');
  if (!modal) return;
  if (msg) msg.textContent = 'Tem certeza que deseja remover este registro das estatísticas? Esta ação não pode ser desfeita.';
  btn.onclick = async () => {
    const id = _statsCtxTrackId;
    _statsCtxTrackId = null;
    statsRemoveModalCancel();
    await _statsTrackDelete(id);
    renderStatsTracks();
    toast('Removida das estatísticas.');
  };
  modal.classList.remove('hidden');
}
function statsCtxRemovePlaylist() {
  if (!_statsCtxPlId) return;
  closeStatsCtxMenus(false);
  const modal = document.getElementById('stats-remove-modal');
  const msg = document.getElementById('stats-remove-modal-msg');
  const btn = document.getElementById('stats-remove-modal-confirm-btn');
  if (!modal) return;
  if (msg) msg.textContent = 'Tem certeza que deseja remover esta playlist das estatísticas? Esta ação não pode ser desfeita.';
  btn.onclick = async () => {
    const id = _statsCtxPlId;
    _statsCtxPlId = null;
    statsRemoveModalCancel();
    await _statsPlDelete(id);
    renderStatsPlaylists();
    toast('Playlist removida das estatísticas.');
  };
  modal.classList.remove('hidden');
}
function statsRemoveModalCancel() {
  const modal = document.getElementById('stats-remove-modal');
  if (modal) modal.classList.add('hidden');
  _statsCtxTrackId = null;
  _statsCtxPlId = null;
}
document.addEventListener('click', e => {
  const m1 = document.getElementById('stats-ctx-menu');
  const m2 = document.getElementById('stats-pl-ctx-menu');
  if (m1 && m1.classList.contains('visible') && !m1.contains(e.target)) m1.classList.remove('visible');
  if (m2 && m2.classList.contains('visible') && !m2.contains(e.target)) m2.classList.remove('visible');
});
document.addEventListener('contextmenu', e => {
  const m1 = document.getElementById('stats-ctx-menu');
  const m2 = document.getElementById('stats-pl-ctx-menu');
  if (m1 && !m1.contains(e.target)) m1.classList.remove('visible');
  if (m2 && !m2.contains(e.target)) m2.classList.remove('visible');
});
function setChartOption(key, val, btn) {
  if (key === 'period') {
    _chartPeriod = val;
    document.querySelectorAll('#chart-period-btns .stats-ctrl-btn').forEach(b => b.classList.remove('active'));
  } else {
    _chartSize = val;
    document.querySelectorAll('#chart-size-btns .stats-ctrl-btn').forEach(b => b.classList.remove('active'));
  }
  btn.classList.add('active');
  renderStatsCharts();
}
async function renderStatsCharts() {
  const area = document.getElementById('stats-chart-area');
  if (!area) return;
  const allRecs = await _statsTrackGetAll();
  let cutoff;
  if (_chartPeriod === 'week') cutoff = _getWeekStart();
  if (_chartPeriod === 'month') cutoff = _getMonthStart();
  if (_chartPeriod === 'year') cutoff = _getYearStart();
  const playsKey = _chartPeriod === 'week' ? 'weekPlays' : _chartPeriod === 'month' ? 'monthPlays' : 'yearPlays';
  function _albumArtistsSig(albumArtistsArr) {
    if (!albumArtistsArr || !Array.isArray(albumArtistsArr) || albumArtistsArr.length === 0) return null;
    return albumArtistsArr.map(n => (n || '').toLowerCase().trim()).sort().join('|');
  }
  function _albumArtistsNames(albumArtistsArr) {
    if (!albumArtistsArr || !Array.isArray(albumArtistsArr)) return [];
    return albumArtistsArr.map(n => (n || '').trim()).filter(Boolean);
  }
  function _safeTrackArtist(artistStr) {
    return (artistStr || '').split(/\s*[,&]\s*|\s+(?:feat\.?|ft\.?|featuring|with)\s+/i)[0].trim();
  }
  const albumMap = new Map();
  for (const r of allRecs) {
    const plays = (r[playsKey] || []).filter(t => t >= cutoff).length;
    if (plays === 0) continue;
    if (r.albumId) {
      const key = r.albumId;
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          key,
          _trackArtist: r.artist,
          trackName: r.albumName || r.name,
          cover: r.cover || null,
          plays: 0,
          isAlbum: true,
          _sigCounts: {},
          _sigNames: {}
        });
      }
      const entry = albumMap.get(key);
      entry.plays += plays;
      if (!entry.cover && r.cover) entry.cover = r.cover;
      if (r.albumArtistSignatureCounts && typeof r.albumArtistSignatureCounts === 'object') {
        for (const [sig, cnt] of Object.entries(r.albumArtistSignatureCounts)) {
          entry._sigCounts[sig] = (entry._sigCounts[sig] || 0) + cnt;
          if (!entry._sigNames[sig] && r.albumArtists && Array.isArray(r.albumArtists)) {
            const names = _albumArtistsNames(r.albumArtists);
            const recSig = _albumArtistsSig(r.albumArtists);
            if (recSig === sig) entry._sigNames[sig] = names;
          }
        }
      } else if (r.albumArtists && Array.isArray(r.albumArtists) && r.albumArtists.length > 0) {
        const sig = _albumArtistsSig(r.albumArtists);
        if (sig) {
          entry._sigCounts[sig] = (entry._sigCounts[sig] || 0) + plays;
          if (!entry._sigNames[sig]) entry._sigNames[sig] = _albumArtistsNames(r.albumArtists);
        }
      }
      if (!entry._trackArtist && r.artist) entry._trackArtist = r.artist;
    } else {
      const key = r.id;
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          key,
          artist: _safeTrackArtist(r.artist),
          trackName: r.name,
          cover: r.cover || null,
          plays: 0,
          isAlbum: false
        });
      }
      albumMap.get(key).plays += plays;
    }
  }
  for (const entry of albumMap.values()) {
    if (!entry.isAlbum) continue;
    const sigCounts = entry._sigCounts || {};
    const sigEntries = Object.entries(sigCounts);
    if (sigEntries.length === 0) {
      entry.artist = _safeTrackArtist(entry._trackArtist);
      continue;
    }
    let domSig = null,
      domCount = 0;
    for (const [sig, cnt] of sigEntries) {
      if (cnt > domCount) {
        domCount = cnt;
        domSig = sig;
      }
    }
    const domNames = domSig ? entry._sigNames[domSig] || null : null;
    if (domNames && domNames.length >= 1) {
      entry.artist = domNames.join(', ');
    } else {
      entry.artist = _safeTrackArtist(entry._trackArtist);
    }
  }
  const total = _chartSize * _chartSize;
  const sorted = [...albumMap.values()].sort((a, b) => b.plays - a.plays);
  if (sorted.length === 0) {
    area.innerHTML = `<div class="stats-chart-empty">Sem reproduções suficientes no período selecionado.</div>`;
    return;
  }
  const cells = sorted.slice(0, total);
  while (cells.length < total) cells.push(null);
  const maxW = Math.min(520, window.innerWidth - 60);
  const cellSizePx = Math.max(44, Math.min(Math.floor(maxW / _chartSize), _chartSize === 3 ? 160 : _chartSize === 5 ? 96 : 52));
  area.innerHTML = `<div class="stats-chart-grid" style="grid-template-columns: repeat(${_chartSize}, ${cellSizePx}px);">
    ${cells.map(c => {
    if (!c) return `<div class="stats-chart-cell" style="width:${cellSizePx}px;height:${cellSizePx}px;"><div class="stats-chart-cell-ph"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg></div></div>`;
    const imgHtml = c.cover ? `<img src="${escHtml(c.cover)}" alt="" style="width:${cellSizePx}px;height:${cellSizePx}px;object-fit:cover;display:block;">` : `<div class="stats-chart-cell-ph" style="width:${cellSizePx}px;height:${cellSizePx}px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg></div>`;
    const tooltipHtml = `<div class="chart-hover-tooltip">
        <div class="chart-hover-artist">${escHtml(c.artist || (c.isAlbum ? '' : 'Sem metadados'))}</div>
        <div class="chart-hover-album">${escHtml(c.trackName || '')}</div>
      </div>`;
    return `<div class="stats-chart-cell stats-chart-cell-hover" style="width:${cellSizePx}px;height:${cellSizePx}px;">${imgHtml}${tooltipHtml}</div>`;
  }).join('')}
  </div>`;
  _chartSetupZoom(_chartSize);
}
function _chartSetupZoom(chartSize) {
  const preview = document.getElementById('chart-zoom-preview');
  const zoomImg = document.getElementById('chart-zoom-img');
  const zoomArtist = document.getElementById('chart-zoom-artist');
  const zoomAlbum = document.getElementById('chart-zoom-album');
  if (!preview) return;
  const area = document.getElementById('stats-chart-area');
  if (!area) return;
  if (area._zoomCleanup) {
    area._zoomCleanup();
    area._zoomCleanup = null;
  }
  if (chartSize !== 10) {
    preview.classList.remove('visible');
    return;
  }
  const ZOOM_W = 160;
  const ZOOM_H = 160;
  const OFFSET = 14;
  let _hideTimer = null;
  function onMouseEnter(e) {
    const cell = e.currentTarget;
    const img = cell.querySelector('img');
    const artistEl = cell.querySelector('.chart-hover-artist');
    const albumEl = cell.querySelector('.chart-hover-album');
    if (!img) return;
    clearTimeout(_hideTimer);
    zoomImg.src = img.src;
    zoomArtist.textContent = artistEl ? artistEl.textContent : '';
    zoomAlbum.textContent = albumEl ? albumEl.textContent : '';
    _positionZoom(e.clientX, e.clientY);
    preview.classList.add('visible');
  }
  function onMouseMove(e) {
    _positionZoom(e.clientX, e.clientY);
  }
  function onMouseLeave() {
    _hideTimer = setTimeout(() => preview.classList.remove('visible'), 80);
  }
  function _positionZoom(cx, cy) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = cx + OFFSET;
    let y = cy - ZOOM_H / 2;
    if (x + ZOOM_W + OFFSET > vw) x = cx - ZOOM_W - OFFSET;
    if (y < 8) y = 8;
    if (y + ZOOM_H > vh - 8) y = vh - ZOOM_H - 8;
    preview.style.left = x + 'px';
    preview.style.top = y + 'px';
  }
  const cells = area.querySelectorAll('.stats-chart-cell-hover');
  cells.forEach(cell => {
    cell.addEventListener('mouseenter', onMouseEnter);
    cell.addEventListener('mousemove', onMouseMove);
    cell.addEventListener('mouseleave', onMouseLeave);
  });
  area._zoomCleanup = () => {
    cells.forEach(cell => {
      cell.removeEventListener('mouseenter', onMouseEnter);
      cell.removeEventListener('mousemove', onMouseMove);
      cell.removeEventListener('mouseleave', onMouseLeave);
    });
    preview.classList.remove('visible');
  };
}
(function () {
  const sw = document.getElementById('settings-wrap');
  const stw = document.getElementById('stats-wrap');
  if (!sw || !stw) return;
  const obs = new MutationObserver(() => {
    stw.style.visibility = sw.style.visibility;
  });
  obs.observe(sw, {
    attributes: true,
    attributeFilter: ['style']
  });
})();
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeStatsModal();
  }
});
function setStatsPeriod(tab, period) {
  const alltimeBtn = document.getElementById(`stats-${tab}-btn-alltime`);
  const weekBtn = document.getElementById(`stats-${tab}-btn-week`);
  if (!alltimeBtn || !weekBtn) return;
  alltimeBtn.classList.toggle('active', period === 'alltime');
  weekBtn.classList.toggle('active', period === 'week');
  const showAlltime = period === 'alltime';
  function _animateIn(el) {
    if (!el) return;
    el.classList.remove('stats-period-content--enter');
    void el.offsetWidth;
    el.classList.add('stats-period-content--enter');
  }
  if (tab === 'tracks') {
    const alltimeTitle = document.getElementById('stats-tracks-alltime-title');
    const alltimeList = document.getElementById('stats-alltime-tracks');
    const weekTitle = document.getElementById('stats-tracks-week-title');
    const weekList = document.getElementById('stats-week-tracks');
    alltimeTitle.style.display = showAlltime ? '' : 'none';
    alltimeList.style.display = showAlltime ? '' : 'none';
    weekTitle.style.display = showAlltime ? 'none' : '';
    weekList.style.display = showAlltime ? 'none' : '';
    if (showAlltime) {
      _animateIn(alltimeTitle);
      _animateIn(alltimeList);
    } else {
      _animateIn(weekTitle);
      _animateIn(weekList);
    }
  } else if (tab === 'playlists') {
    const alltimeTitle = document.getElementById('stats-playlists-alltime-title');
    const alltimeList = document.getElementById('stats-alltime-playlists');
    const weekTitle = document.getElementById('stats-playlists-week-title');
    const weekList = document.getElementById('stats-week-playlists');
    alltimeTitle.style.display = showAlltime ? '' : 'none';
    alltimeList.style.display = showAlltime ? '' : 'none';
    weekTitle.style.display = showAlltime ? 'none' : '';
    weekList.style.display = showAlltime ? 'none' : '';
    if (showAlltime) {
      _animateIn(alltimeTitle);
      _animateIn(alltimeList);
    } else {
      _animateIn(weekTitle);
      _animateIn(weekList);
    }
  }
}
function plCharInput(inputId, counterId, limit) {
  const el = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if (!el) return;
  if (el.value.length > limit) {
    el.value = el.value.slice(0, limit);
  }
  const len = el.value.length;
  if (counter) {
    counter.textContent = len + '/' + limit;
    counter.classList.toggle('overlimit', len >= limit);
  }
  el.classList.toggle('input-overlimit', len >= limit);
}
function plDescInput(inputId, counterId, limit) {
  plCharInput(inputId, counterId, limit);
}
function plTagCharInput(inputId, counterId, limit) {
  plCharInput(inputId, counterId, limit);
}
function _setupPlCoverZoom() {
  const preview = document.getElementById('pl-cover-zoom-preview');
  const zoomImg = document.getElementById('pl-cover-zoom-img');
  if (!preview || !zoomImg) return;
  const ZOOM_W = 160;
  const ZOOM_H = 160;
  const OFFSET = 14;
  let _hideTimer = null;
  function _positionZoom(cx, cy) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = cx + OFFSET;
    let y = cy - ZOOM_H / 2;
    if (x + ZOOM_W + OFFSET > vw) x = cx - ZOOM_W - OFFSET;
    if (y < 8) y = 8;
    if (y + ZOOM_H > vh - 8) y = vh - ZOOM_H - 8;
    preview.style.left = x + 'px';
    preview.style.top = y + 'px';
  }
  const coverEl = document.getElementById('playlist-detail-cover');
  if (!coverEl) return;
  if (coverEl._zoomCleanup) {
    coverEl._zoomCleanup();
    coverEl._zoomCleanup = null;
  }
  function onMouseEnter(e) {
    const img = coverEl.querySelector('img');
    if (!img) return;
    clearTimeout(_hideTimer);
    zoomImg.src = img.src;
    _positionZoom(e.clientX, e.clientY);
    preview.classList.add('visible');
  }
  function onMouseMove(e) {
    _positionZoom(e.clientX, e.clientY);
  }
  function onMouseLeave() {
    _hideTimer = setTimeout(() => preview.classList.remove('visible'), 80);
  }
  coverEl.addEventListener('mouseenter', onMouseEnter);
  coverEl.addEventListener('mousemove', onMouseMove);
  coverEl.addEventListener('mouseleave', onMouseLeave);
  coverEl._zoomCleanup = () => {
    coverEl.removeEventListener('mouseenter', onMouseEnter);
    coverEl.removeEventListener('mousemove', onMouseMove);
    coverEl.removeEventListener('mouseleave', onMouseLeave);
    preview.classList.remove('visible');
  };
}