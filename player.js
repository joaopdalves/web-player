let tracks         = [];
let currentIndex   = -1;
let isPlaying      = false;
let isShuffle      = false;
let isRepeat       = false;
let isMuted        = false;
let isSeeking      = false;
let pendingFile    = null;
let spotifyToken   = null;
let tokenExpiry    = 0;
let _batchQueue    = [];
let queue          = [];
let ctxTargetIndex = -1;
let _confirmCallback = null;
let toastTimer;
let searchQuery    = '';
let db             = null;
window._editDataTrackIndex = -1;

const ITEM_H      = 62;
let vScrollTop    = 0;
let vContainerH   = 0;
let vTotalItems   = 0;
let vFilteredCache = [];

let _shufflePool  = [];

const _pwStore = (() => {
  let _v = null;
  return {
    set(v) { _v = v; },
    get()  { return _v; },
    clear(){ _v = null; }
  };
})();

let lfmSessionKey    = null;
let lfmApiKey        = null;
let lfmApiSecret     = null;
let lfmUsername      = null;
let lfmPendingToken  = null;
let scrobbleTimer    = null;
let nowPlayingTrack  = null;
let scrobbled        = false;
let scrobbleThreshold = 0;
let organicListenTime = 0;
let lastTimeUpdatePos = null;

let dragSrcIndex      = -1;
let _dragActive       = false;
let _dragPending      = false;
let _dragEl           = null;
let _dragStartX       = 0;
let _dragStartY       = 0;
let _dragPendingIndex = -1;
let _dragLeftItem     = false;
const DRAG_THRESHOLD  = 5;

const audio = document.getElementById('audio-el');

function _hasEncryptedCreds() {
  return ['sp_cid', 'sp_cs', 'lfm_key', 'lfm_secret'].some(k => !!localStorage.getItem('enc_' + k));
}

function _getFirstEncryptedKey() {
  const found = ['sp_cid', 'sp_cs', 'lfm_key', 'lfm_secret'].find(k => !!localStorage.getItem('enc_' + k));
  return found ? 'enc_' + found : null;
}

async function _deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function saveSecret(storageKey, value) {
  const pw = _pwStore.get();
  if (!pw) throw new Error('Sem senha master ativa');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await _deriveKey(pw, salt);
  const enc  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  localStorage.setItem('enc_' + storageKey, JSON.stringify({
    salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(enc))
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
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(stored.iv) },
      key,
      new Uint8Array(stored.data)
    );
    return new TextDecoder().decode(dec);
  } catch { return null; }
}

function removeSecret(storageKey) {
  localStorage.removeItem('enc_' + storageKey);
}

let _masterResolve = null;
let _masterAttempts = parseInt(localStorage.getItem('_masterAttempts') || '0', 10);
let _masterLockedUntil = parseInt(localStorage.getItem('_masterLockedUntil') || '0', 10);

const _masterPlaceholders = { 'master-input': 'Digite uma senha', 'master-confirm': 'Repita a senha' };
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
function _masterErr(msg, targetId = 'master-input') {
  const input = document.getElementById(targetId);
  input.value = '';
  input.placeholder = msg;
  input.classList.add('input-error');
  input.focus();
}
function _masterErrClear() {
  ['master-input', 'master-confirm'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('input-error');
    el.placeholder = _masterPlaceholders[id];
  });
}

function masterPrompt() {
  return new Promise(resolve => {
    _masterResolve = resolve;
    const hasData = _hasEncryptedCreds();
    document.getElementById('master-title').textContent  = hasData ? 'Digite sua senha' : 'Criar senha';
    document.getElementById('master-sub').textContent    = hasData
      ? 'Digite a senha para descriptografar suas credenciais salvas.'
      : 'Esta senha criptografa suas credenciais localmente. Não é possível recuperá-la.';
    document.getElementById('master-label').textContent  = hasData ? 'Senha' : 'Nova senha';
    document.getElementById('master-confirm-group').style.display = hasData ? 'none' : '';
    document.getElementById('master-btn').textContent    = hasData ? 'Entrar' : 'Criar';
    _masterErrClear();
    document.getElementById('master-input').value        = '';
    document.getElementById('master-confirm').value      = '';

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
      _masterErr('Você esgotou as suas tentativas.');
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
  const pw   = document.getElementById('master-input').value;
  const pw2  = document.getElementById('master-confirm').value;
  const btn  = document.getElementById('master-btn');
  const hasData = _hasEncryptedCreds();

  // Cooldown check comes first — show it even when field is empty
  if (hasData) {
    const now = Date.now();
    if (_masterLockedUntil > now) {
      const secs = Math.ceil((_masterLockedUntil - now) / 1000);
      _masterErr(`Aguarde ${secs}s antes de tentar novamente.`);
      return;
    }
  }

  if (!pw) { _masterErr('Digite uma senha.'); return; }
  if (!hasData) {
    if (pw.length < 6) { _masterErr('Mínimo 6 caracteres.'); return; }
    if (pw !== pw2)    { _masterErr('As senhas não conferem.', 'master-confirm'); return; }
  }

  btn.textContent = '...'; btn.disabled = true;

  if (hasData) {
    try {
      const firstKey = _getFirstEncryptedKey();
      const raw     = JSON.parse(localStorage.getItem(firstKey));
      const testKey = await _deriveKey(pw, new Uint8Array(raw.salt));
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(raw.iv) },
        testKey,
        new Uint8Array(raw.data)
      );
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
        _masterErr('Você esgotou as suas tentativas.');
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
        _masterErr(`Senha incorreta. ${restantes} tentativa${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''}${waitSec > 0 ? ` — aguarde ${waitSec}s` : ''}.`);
        btn.textContent = 'Entrar'; btn.disabled = false;
      }
      return;
    }
  }

  _pwStore.set(pw);
  document.getElementById('master-overlay').classList.add('hidden');
  const appEl = document.getElementById('app');
  appEl.style.visibility = 'visible';
  requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.add('app-visible')));
  document.getElementById('settings-wrap').style.visibility = 'visible';
  btn.textContent = hasData ? 'Entrar' : 'Criar'; btn.disabled = false;
  if (_masterResolve) { _masterResolve(pw); _masterResolve = null; }
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
      openReq.onsuccess = function(e) {
        const d = e.target.result;
        d.close();
        db = null;
        indexedDB.deleteDatabase('player_db');
      };
      openReq.onerror = function() {
        indexedDB.deleteDatabase('player_db');
      };
    } catch(e) {  }
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
  document.getElementById('master-sub').textContent   = 'Esta senha criptografa suas credenciais localmente. Não é possível recuperá-la.';
  document.getElementById('master-label').textContent = 'Nova senha';
  document.getElementById('master-confirm-group').style.display = '';
  btn.textContent = 'Criar';
  document.getElementById('master-input').value  = '';
  document.getElementById('master-confirm').value = '';
  setTimeout(() => document.getElementById('master-input').focus(), 100);
}

async function init() {
  await masterPrompt();
  const spCid = await loadSecret('sp_cid');
  const spCs  = await loadSecret('sp_cs');
  if (spCid && spCs) {
    document.getElementById('setup-overlay').style.visibility = 'visible';
    document.getElementById('setup-overlay').classList.add('hidden');
  } else {
    document.getElementById('setup-overlay').style.visibility = 'visible';
  }
  await loadTracks();
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
    appEl.addEventListener('transitionend', doRender, { once: true });
  }
}

function switchTab(tab) {
  ['spotify','lastfm'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t === tab);
    document.getElementById('panel-'+t).classList.toggle('active', t === tab);
  });
}

function saveCredentials() {
  const cid    = document.getElementById('setup-client-id').value.trim();
  const cs     = document.getElementById('setup-client-secret').value.trim();
  const lfmKey = document.getElementById('lfm-api-key').value.trim();
  const lfmSec = document.getElementById('lfm-api-secret').value.trim();
  (async () => {
    if (cid && cs) { await saveSecret('sp_cid', cid); await saveSecret('sp_cs', cs); }
    if (lfmKey) await saveSecret('lfm_key', lfmKey);
    if (lfmSec) await saveSecret('lfm_secret', lfmSec);
    const spCid = await loadSecret('sp_cid');
    const spCs  = await loadSecret('sp_cs');
    if (!spCid || !spCs) { toast('Preencha as credenciais do Spotify primeiro.'); switchTab('spotify'); return; }
    document.getElementById('setup-overlay').classList.add('hidden');
    lfmInit();
    toast('Configurações salvas!');
  })();
}

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < tokenExpiry) return spotifyToken;
  const cid = await loadSecret('sp_cid');
  const cs  = await loadSecret('sp_cs');

  const tokenUrl = 'https://accounts.spotify.com/api/token';
  const body = 'grant_type=client_credentials';
  const auth = 'Basic ' + btoa(cid + ':' + cs);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': auth };

  const proxies = [
    tokenUrl,
    'https://corsproxy.io/?' + encodeURIComponent(tokenUrl),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(tokenUrl),
    'https://proxy.cors.sh/' + tokenUrl,
  ];

  let data;
  for (const url of proxies) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) continue;
      data = await res.json();
      if (data.access_token) break;
    } catch(e) { continue; }
  }

  if (!data || !data.access_token) throw new Error('Não foi possível conectar ao Spotify. Verifique suas credenciais e tente novamente.');
  spotifyToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

function extractTrackId(url) {
  const m = url.match(/\/track\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function fetchSpotifyMeta(url) {
  const id = extractTrackId(url);
  if (!id) throw new Error('Link inválido. Use um link do tipo open.spotify.com/track/');

  const token = await getSpotifyToken();
  const apiUrl = `https://api.spotify.com/v1/tracks/${id}`;
  const headers = { 'Authorization': 'Bearer ' + token };

  const proxies = [
    apiUrl,
    'https://corsproxy.io/?' + encodeURIComponent(apiUrl),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(apiUrl),
    'https://proxy.cors.sh/' + apiUrl,
  ];

  let d;
  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl, { headers });
      if (!res.ok) continue;
      d = await res.json();
      if (d.name) break;
    } catch(e) { continue; }
  }

  if (!d || !d.name) throw new Error('Música não encontrada. Verifique o link do Spotify.');
  return {
    name: d.name,
    artist: d.artists.map(a => a.name).join(', '),
    cover: d.album.images[0]?.url || null,
    spotifyUrl: url
  };
}

function triggerAddTrack() {
  document.getElementById('file-picker-overlay').classList.remove('hidden');
}

function fpClose() {
  document.getElementById('file-picker-overlay').classList.add('hidden');
  document.getElementById('fp-drop-zone').classList.remove('dragover');
}

function fpBrowse() {
  const input = document.getElementById('file-input');
  const doRestore = () => { if (window._restoreCursor) window._restoreCursor(); };
  window.addEventListener('focus',     doRestore, { once: true });
  window.addEventListener('mousemove', doRestore, { once: true });
  input.click();
}

function fpDragOver(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('fp-drop-zone').classList.add('dragover');
}

function fpDragLeave(e) {
  e.stopPropagation();
  document.getElementById('fp-drop-zone').classList.remove('dragover');
}

function fpDrop(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('fp-drop-zone').classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || /\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|aiff)$/i.test(f.name));
  if (!files.length) { toast('Nenhum arquivo de áudio encontrado.'); return; }
  fpClose();
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
  fpClose();
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
  document.getElementById('modal-overlay').classList.add('hidden');
  pendingFile = null;
  window._editDataTrackIndex = -1;
  const title = document.getElementById('modal-title');
  const hint  = document.getElementById('modal-hint');
  const noDataBtn = document.getElementById('btn-no-data');
  if (title) title.textContent = 'Adicionar música';
  if (hint)  hint.textContent  = 'Cole o link da música no Spotify para buscar automaticamente a capa, nome e artista. Obrigatório para adicionar com dados.';
  if (noDataBtn) noDataBtn.style.display = '';

  if (_batchQueue.length > 0) {
    setTimeout(() => _batchProcessNext(), 300);
  }
}

async function confirmAdd() {
  const url = document.getElementById('modal-spotify-url').value.trim();
  const btn = document.getElementById('btn-confirm');
  const editIdx = (window._editDataTrackIndex >= 0) ? window._editDataTrackIndex : -1;

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
      t.noData = false;
      if (t.coverUrl && t.coverUrl.startsWith('blob:')) URL.revokeObjectURL(t.coverUrl);
      t.coverUrl = meta.cover || null;
      saveTrack(t);
      if (currentIndex === editIdx) selectTrack(editIdx);
      else renderList();
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
    if (name < tracks[i].name.toLowerCase()) { insertAt = i; break; }
  }

  const currentId = currentIndex >= 0 ? tracks[currentIndex]?.id : null;
  tracks.splice(insertAt, 0, track);
  if (currentId) currentIndex = tracks.findIndex(t => t.id === currentId);
  tracks.forEach((t, idx) => { t.order = idx; saveTrack(t); });
}

function addTrackLocal(meta) {
  if (!pendingFile) return;
  const id = 'track_' + Date.now();
  const reader = new FileReader();
  reader.onload = function(e) {
    const track = {
      id,
      name: meta.name,
      artist: meta.artist,
      cover: meta.cover,
      spotifyUrl: meta.spotifyUrl || null,
      noData: meta.noData || false,
      fileData: e.target.result,
      fileName: pendingFile.name,
      order: Date.now()
    };
    track.blobUrl  = _base64ToBlobURL(track.fileData, 'audio/mpeg');
    if (track.cover && track.cover.startsWith('data:')) {
      const mime = track.cover.split(';')[0].split(':')[1] || 'image/jpeg';
      track.coverUrl = _base64ToBlobURL(track.cover, mime);
    } else {
      track.coverUrl = track.cover || null;
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
  reader.onload = function(ev) {
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
    track.blobUrl  = _base64ToBlobURL(track.fileData, 'audio/mpeg');
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
  const hint  = document.getElementById('modal-hint');
  if (title) title.textContent = remaining > 0
    ? `Adicionar música (faltam ${remaining + 1})`
    : 'Adicionar música';
  if (hint) hint.textContent = `Arquivo: ${file.name.replace(/\.[^.]+$/, '')} — cole o link do Spotify ou clique em "Buscar e adicionar" para pular.`;
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-spotify-url').focus(), 100);
}

function dbOpen() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open('player_db', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tracks')) {
        d.createObjectStore('tracks', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      db.onclose = () => { db = null; };
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
        id: t.id, name: t.name, artist: t.artist, cover: t.cover,
        spotifyUrl: t.spotifyUrl || null, noData: t.noData || false,
        fileData: t.fileData, fileName: t.fileName, order: t.order
      });
      r.onsuccess = res; r.onerror = rej;
    });
  } catch(e) { toast('Aviso: erro ao salvar música.'); console.error('DB save error:', e); }
}

async function deleteTrackFromDB(id) {
  try {
    const d = await dbOpen();
    const tx = d.transaction('tracks', 'readwrite');
    const store = tx.objectStore('tracks');
    await new Promise((res, rej) => { const r = store.delete(id); r.onsuccess = res; r.onerror = rej; });
  } catch(e) { console.error('DB delete error:', e); }
}

function _base64ToBlobURL(dataUrl, mime) {
  try {
    const base64 = dataUrl.split(',')[1];
    const bytes  = atob(base64);
    const buf    = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return URL.createObjectURL(new Blob([buf], { type: mime }));
  } catch { return dataUrl; }
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
          } else {
            t.coverUrl = t.cover || null;
          }
        });
        res(result);
      };
      r.onerror = () => res([]);
    });
  } catch(e) { tracks = []; }
}

function getFiltered() {
  if (!searchQuery) return tracks.map((t, i) => ({ t, i }));
  const result = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.name.toLowerCase().includes(searchQuery) || t.artist.toLowerCase().includes(searchQuery))
      result.push({ t, i });
  }
  return result;
}

function highlight(text, query) {
  if (!query) return escHtml(text);
  const escaped = escHtml(text);
  const escapedQuery = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedQuery})`, 'gi'),
    '<mark style="background:var(--accent-dim);color:var(--accent);border-radius:2px;padding:0 1px;">$1</mark>');
}

function renderTrackHTML(t, i, extraStyle = '') {
  return `<div class="track-item ${i === currentIndex ? 'active' : ''}" onclick="selectTrack(${i})" oncontextmenu="openCtxMenu(event,${i})" onmousedown="trackItemMouseDown(event,${i})" id="ti-${t.id}" data-index="${i}" style="height:${ITEM_H}px;box-sizing:border-box;${extraStyle}">
    <div class="track-drag-handle" onmousedown="dragHandleMouseDown(event,${i})" onclick="event.stopPropagation()" data-tip="Arrastar para reorganizar">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
    </div>
    ${(t.coverUrl || t.cover)
      ? `<img class="track-cover" src="${t.coverUrl || t.cover}" alt="">`
      : `<div class="track-cover-placeholder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`
    }
    <div class="track-info">
      <div class="track-name" data-tip="${escHtml(t.name)}">${highlight(t.name, searchQuery)}</div>
      <div class="track-artist">${highlight(t.artist, searchQuery)}</div>
    </div>
  </div>`;
}

function renderVirtual() {
  const list = document.getElementById('track-list');
  document.getElementById('track-count').textContent =
    tracks.length + ' música' + (tracks.length !== 1 ? 's' : '');

  vFilteredCache = getFiltered();
  vTotalItems    = vFilteredCache.length;
  vContainerH    = list.clientHeight || 500;
  vScrollTop     = list.scrollTop;

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
  const visible  = Math.ceil(vContainerH / ITEM_H) + overscan * 2;
  const endIdx   = Math.min(vTotalItems - 1, startIdx + visible);

  const topPad    = startIdx * ITEM_H;
  const bottomPad = Math.max(0, (vTotalItems - endIdx - 1) * ITEM_H);

  let html = `<div style="height:${topPad}px;flex-shrink:0;"></div>`;
  const isInitialLoad = !_appReadyForTrackAnim;
  if (isInitialLoad) _appReadyForTrackAnim = true;
  let animIdx = 0;
  for (let vi = startIdx; vi <= endIdx; vi++) {
    const { t, i } = vFilteredCache[vi];
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
    const el = document.getElementById('ti-' + tracks[dragSrcIndex]?.id) ||
               document.querySelector(`[data-index="${dragSrcIndex}"]`);
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

function filterTracks(query) {
  searchQuery = query.trim().toLowerCase();
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchQuery);
  renderList();
}

function clearSearch() {
  searchQuery = '';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderList();
}

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function selectTrack(i) {
  if (i < 0 || i >= tracks.length) return;
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
    scrobbleBar.style.display = (lfmSessionKey && t.spotifyUrl) ? '' : 'none';
  }

  audio.play().then(() => {
    setPlaying(true);
    if (!t.noData && t.spotifyUrl) {
      audio.addEventListener('loadedmetadata', function onMeta() {
        audio.removeEventListener('loadedmetadata', onMeta);
        lfmOnTrackStart(t, audio.duration);
      }, { once: true });
      if (audio.duration) lfmOnTrackStart(t, audio.duration);
    }
  }).catch(() => setPlaying(false));

  document.getElementById('song-title').textContent = t.name;
  document.getElementById('song-artist').textContent = t.artist;
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

  const list = document.getElementById('track-list');
  const itemTop = i * ITEM_H;
  const itemBot = itemTop + ITEM_H;
  if (itemTop < list.scrollTop || itemBot > list.scrollTop + list.clientHeight) {
    list.scrollTop = itemTop - list.clientHeight / 2 + ITEM_H / 2;
  }
}

function setPlaying(state) {
  isPlaying = state;
  document.getElementById('icon-play').style.display  = state ? 'none'  : 'block';
  document.getElementById('icon-pause').style.display = state ? 'block' : 'none';
  const art = document.getElementById('album-art');
  if (state) art.classList.add('playing'); else art.classList.remove('playing');
}

function togglePlay() {
  if (currentIndex < 0) {
    if (tracks.length > 0) selectTrack(0);
    return;
  }
  if (isPlaying) { audio.pause(); }
  else { audio.play().catch(() => {}); }
}

function prevTrack() {
  if (tracks.length === 0) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let idx = currentIndex - 1;
  if (idx < 0) idx = tracks.length - 1;
  selectTrack(idx);
}

function nextTrack() {
  if (tracks.length === 0) return;
  if (queue.length > 0) {
    const nextIdx = queue.shift();
    selectTrack(nextIdx);
    return;
  }
  let idx;
  if (isShuffle) {
    idx = shuffleNext();
  } else {
    idx = currentIndex + 1;
    if (idx >= tracks.length) idx = 0;
  }
  selectTrack(idx);
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

function toggleShuffle() {
  isShuffle = !isShuffle;
  _shufflePool = [];
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
  if (pb) { pb.disabled = true; pb.value = 0; pb.style.setProperty('--pct', '0%'); }
  document.getElementById('time-current').textContent = '0:00';
  document.getElementById('time-total').textContent   = '0:00';
}

function deleteTrack(e, i) {
  if (e && e.stopPropagation) e.stopPropagation();
  const t = tracks[i];
  showConfirmDelete(t.name, () => {
    const removedId = t.id;
    if (t.blobUrl)  URL.revokeObjectURL(t.blobUrl);
    if (t.coverUrl && t.coverUrl.startsWith('blob:')) URL.revokeObjectURL(t.coverUrl);
    tracks.splice(i, 1);
    queue = queue.filter(qi => qi !== i).map(qi => qi > i ? qi - 1 : qi);
    _shufflePool = [];
    if (currentIndex === i) {
      clearNowPlaying(); setPlaying(false);
    } else if (currentIndex > i) {
      currentIndex--;
    }
    deleteTrackFromDB(removedId);
    renderList();
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
    }
    else nextTrack();
  });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', () => {
    document.getElementById('time-total').textContent = formatTime(audio.duration);
  });
  audio.addEventListener('play',  () => setPlaying(true));
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
  const pct = (audio.currentTime / audio.duration) * 100;
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
      audio.currentTime = (bar.value / 100) * audio.duration;
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
    tooltip.style.top = (rect.top - 32) + 'px';
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
  if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight') {
    e.preventDefault();
    isSeeking = true; lastTimeUpdatePos = null;
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    isSeeking = false;
  }
  if (e.code === 'ArrowLeft') {
    e.preventDefault();
    isSeeking = true; lastTimeUpdatePos = null;
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
    lfmApiKey     = await loadSecret('lfm_key');
    lfmApiSecret  = await loadSecret('lfm_secret');
    lfmSessionKey = await loadSecret('lfm_session');
    lfmUsername   = await loadSecret('lfm_user') || '';
    if (lfmApiKey)    { const el = document.getElementById('lfm-api-key');    if(el) el.value = lfmApiKey; }
    if (lfmApiSecret) { const el = document.getElementById('lfm-api-secret'); if(el) el.value = lfmApiSecret; }
    lfmUpdateStatusUI();
  })();
}

function lfmStatusClick() {
  toggleSettingsPanel(true);
}

function lfmUpdateStatusUI() {
  const el  = document.getElementById('lastfm-status');
  const txt = document.getElementById('lfm-status-text');
  if (!el) return;
  if (lfmSessionKey) {
    el.classList.add('connected');
    el.classList.remove('scrobbling');
    if (txt) txt.textContent = lfmUsername || '';
    el.title = lfmUsername ? `Last.fm: ${lfmUsername}` : 'Last.fm conectado';
    // Re-show scrobble bar if a track with spotify data is playing
    if (currentIndex >= 0 && tracks[currentIndex]?.spotifyUrl) {
      const bar = document.getElementById('lfm-scrobble-bar');
      if (bar) bar.style.display = '';
    }
  } else {
    el.classList.remove('connected','scrobbling');
    if (txt) txt.textContent = '';
    el.title = lfmApiKey ? 'Last.fm: clique para autenticar' : 'Last.fm: clique para conectar';
    // Hide and reset scrobble bar — no session means no scrobbling
    scrobbleThreshold = 0;
    nowPlayingTrack = null;
    const bar = document.getElementById('lfm-scrobble-bar');
    if (bar) { bar.style.display = 'none'; bar.style.setProperty('--scrobble-pct', '0%'); }
  }
  updateSettingsLfmRow();
}

function lfmOpenSettings() {
  document.getElementById('setup-overlay').classList.remove('hidden');
  switchTab('lastfm');
  (async () => {
    document.getElementById('lfm-api-key').value    = await loadSecret('lfm_key') || '';
    document.getElementById('lfm-api-secret').value = await loadSecret('lfm_secret') || '';
  })();
}

function lfmDisconnect() {
  if (!confirm('Desconectar Last.fm? Scrobbles não serão mais registrados.')) return;
  removeSecret('lfm_session');
  removeSecret('lfm_user');
  localStorage.removeItem('lfm_pending_token');
  lfmSessionKey = null;
  lfmUsername   = null;
  lfmPendingToken = null;
  lfmUpdateStatusUI();
  toast('Last.fm desconectado.');
}

async function lfmStartAuth() {
  const key = document.getElementById('lfm-api-key').value.trim();
  const sec = document.getElementById('lfm-api-secret').value.trim();
  if (!key || !sec) {
    document.getElementById('lfm-setup-status').textContent = '⚠️ Preencha API Key e Shared Secret.';
    return;
  }
  await saveSecret('lfm_key', key);
  await saveSecret('lfm_secret', sec);
  lfmApiKey = key;
  lfmApiSecret = sec;

  document.getElementById('lfm-setup-status').textContent = 'Obtendo token...';

  try {
    const token = await lfmGetToken();
    lfmPendingToken = token;
    localStorage.setItem('lfm_pending_token', token);

    const authUrl = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
    document.getElementById('lfm-auth-link').href = authUrl;
    document.getElementById('lfm-modal-status').textContent = '';
    document.getElementById('lfm-auth-modal').classList.remove('hidden');
    document.getElementById('lfm-setup-status').textContent = '';
  } catch(e) {
    document.getElementById('lfm-setup-status').textContent = '✗ ' + e.message;
  }
}

async function lfmGetToken() {
  const params = { method: 'auth.getToken', api_key: lfmApiKey };
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
  if (!token) { status.textContent = '✗ Token expirado. Reinicie a autenticação.'; btn.disabled=false; btn.textContent='Já autorizei ✓'; return; }

  try {
    const params = { method: 'auth.getSession', api_key: lfmApiKey, token };
    const sig = lfmSign(params);
    const url = `https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${lfmApiKey}&token=${token}&api_sig=${sig}&format=json`;
    const res = await lfmFetch(url);
    const data = await res.json();

    if (data.error) throw new Error(data.message || 'Erro ao obter sessão. Verifique se clicou em Allow no Last.fm.');

    lfmSessionKey = data.session.key;
    lfmUsername   = data.session.name;
    await saveSecret('lfm_session', lfmSessionKey);
    await saveSecret('lfm_user', lfmUsername);
    localStorage.removeItem('lfm_pending_token');

    document.getElementById('lfm-auth-modal').classList.add('hidden');
    document.getElementById('setup-overlay').classList.add('hidden');
    lfmUpdateStatusUI();
    toast(`Last.fm conectado como ${lfmUsername}! 🔴`);
  } catch(e) {
    status.textContent = '✗ ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Já autorizei ✓';
  }
}

function lfmSign(params) {
  const sorted = Object.keys(params).sort().map(k => k + params[k]).join('');
  return md5(sorted + lfmApiSecret);
}

async function lfmFetch(url, options) {
  try {
    const r = await fetch(url, options);
    if (!r.ok) throw new Error('status ' + r.status);
    return r;
  } catch(e) {
    const proxy = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const r2 = await fetch(proxy, options);
    if (!r2.ok) throw new Error('Erro na requisição Last.fm');
    return r2;
  }
}

async function lfmPost(params) {
  params.api_key = lfmApiKey;
  params.sk = lfmSessionKey;
  params.format = 'json';
  const sig = lfmSign(Object.fromEntries(Object.entries(params).filter(([k])=>k!=='format')));
  params.api_sig = sig;

  const body = new URLSearchParams(params).toString();
  const url = 'https://ws.audioscrobbler.com/2.0/';

  try {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body });
    return await r.json();
  } catch(e) {
    const proxy = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const r2 = await fetch(proxy, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body });
    return await r2.json();
  }
}

async function lfmUpdateNowPlaying(track) {
  if (!lfmSessionKey || !lfmApiKey) return;
  try {
    await lfmPost({
      method: 'track.updateNowPlaying',
      track: track.name,
      artist: track.artist,
      duration: Math.round(track.duration) || ''
    });
  } catch(e) {  }
}

async function lfmScrobble(track) {
  if (!lfmSessionKey || !lfmApiKey) return;
  try {
    const data = await lfmPost({
      method: 'track.scrobble',
      track: track.name,
      artist: track.artist,
      timestamp: Math.round(track.startTime / 1000),
      duration: Math.round(track.duration) || ''
    });
    if (data.error) {
      console.warn('Last.fm scrobble error:', data.message);
    } else {
      const el = document.getElementById('lastfm-status');
      if (el) {
        el.classList.add('scrobbling');
        setTimeout(() => { el.classList.remove('scrobbling'); lfmUpdateStatusUI(); }, 3000);
      }
      toast(`Scrobble: ${track.name}`);
    }
  } catch(e) { console.warn('Last.fm scrobble failed:', e); }
}

function lfmOnTrackStart(trackObj, duration) {
  clearTimeout(scrobbleTimer);
  scrobbled = false;
  organicListenTime = 0;
  lastTimeUpdatePos = null;
  isSeeking = false;

  if (!lfmSessionKey) {
    scrobbleThreshold = 0;
    const bar = document.getElementById('lfm-scrobble-bar');
    if (bar) bar.style.display = 'none';
    return;
  }

  nowPlayingTrack = {
    name: trackObj.name,
    artist: trackObj.artist,
    duration: duration,
    startTime: Date.now()
  };

  lfmUpdateNowPlaying(nowPlayingTrack);

  if (duration > 30) {
    scrobbleThreshold = Math.min(duration * 0.5, 240);
  } else {
    scrobbleThreshold = 0;
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
    lfmScrobble(nowPlayingTrack);
    const bar = document.getElementById('lfm-scrobble-bar');
    if (bar) bar.style.setProperty('--scrobble-pct','100%');
  }
}

function updateScrobbleBar(listenedTime, duration) {
  if (!lfmSessionKey || !duration || scrobbleThreshold === 0) return;
  const bar = document.getElementById('lfm-scrobble-bar');
  if (!bar) return;
  const pct = Math.min((listenedTime / scrobbleThreshold) * 100, 100);
  bar.style.setProperty('--scrobble-pct', pct.toFixed(1) + '%');
}

function md5(inputString) {
  var hc="0123456789abcdef";
  function rh(n) {var j,s="";for(j=0;j<=3;j++) s+=hc.charAt((n>>(j*8+4))&0x0F)+hc.charAt((n>>(j*8))&0x0F);return s;}
  function ad(x,y) {var l=(x&0xFFFF)+(y&0xFFFF);var m=(x>>16)+(y>>16)+(l>>16);return (m<<16)|(l&0xFFFF);}
  function rl(n,c) {return (n<<c)|(n>>>(32-c));}
  function cm(q,a,b,x,s,t) {return ad(rl(ad(ad(a,q),ad(x,t)),s),b);}
  function ff(a,b,c,d,x,s,t) {return cm((b&c)|((~b)&d),a,b,x,s,t);}
  function gg(a,b,c,d,x,s,t) {return cm((b&d)|(c&(~d)),a,b,x,s,t);}
  function hh(a,b,c,d,x,s,t) {return cm(b^c^d,a,b,x,s,t);}
  function ii(a,b,c,d,x,s,t) {return cm(c^(b|(~d)),a,b,x,s,t);}
  function sb(x) {
    var i,nblk=((x.length+8)>>6)+1,blks=new Array(nblk*16);
    for(i=0;i<nblk*16;i++) blks[i]=0;
    for(i=0;i<x.length;i++) blks[i>>2]|=x.charCodeAt(i)<<((i%4)*8);
    blks[i>>2]|=0x80<<((i%4)*8);blks[nblk*16-2]=x.length*8;return blks;
  }
  var i,x=sb(inputString),a=1732584193,b=-271733879,c=-1732584194,d=271733878,olda,oldb,oldc,oldd;
  for(i=0;i<x.length;i+=16) {
    olda=a;oldb=b;oldc=c;oldd=d;
    a=ff(a,b,c,d,x[i+0],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);
    a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);
    a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);
    a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);
    a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i+0],20,-373897302);
    a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);
    a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);
    a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);
    a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);
    a=hh(a,b,c,d,x[i+1],4,-1530992060);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,-155497632);b=hh(b,c,d,a,x[i+10],23,-1094730640);
    a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i+0],11,-358537222);c=hh(c,d,a,b,x[i+3],16,-722521979);b=hh(b,c,d,a,x[i+6],23,76029189);
    a=hh(a,b,c,d,x[i+9],4,-640364487);d=hh(d,a,b,c,x[i+12],11,-421815835);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,-995338651);
    a=ii(a,b,c,d,x[i+0],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);
    a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);
    a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);
    a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);
    a=ad(a,olda);b=ad(b,oldb);c=ad(c,oldc);d=ad(d,oldd);
  }
  return rh(a)+rh(b)+rh(c)+rh(d);
}

function showConfirmDelete(trackName, onConfirm) {
  _confirmCallback = onConfirm;
  document.getElementById('confirm-msg').innerHTML =
    `Tem certeza que deseja remover <strong>"${escHtml(trackName)}"</strong> da sua biblioteca? Esta ação não pode ser desfeita.`;
  document.getElementById('confirm-yes-btn').onclick = () => { const cb = _confirmCallback; closeConfirmDelete(); if (cb) cb(); };
  document.getElementById('confirm-overlay').classList.remove('hidden');
}
function closeConfirmDelete() {
  document.getElementById('confirm-overlay').classList.add('hidden');
  _confirmCallback = null;
}
document.getElementById('confirm-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeConfirmDelete();
});

function openCtxMenu(e, index) {
  e.preventDefault(); e.stopPropagation();
  ctxTargetIndex = index;
  const menu = document.getElementById('ctx-menu');
  const t = tracks[index];
  const isNoData = t && t.noData;
  const addDataItem = document.getElementById('ctx-item-adddata');
  const addDataSep  = document.getElementById('ctx-sep-adddata');
  if (addDataItem) addDataItem.style.display = isNoData ? '' : 'none';
  if (addDataSep)  addDataSep.style.display  = isNoData ? '' : 'none';
  menu.classList.add('visible');
  const mw = 210, mh = isNoData ? 150 : 110;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
}
function closeCtxMenu() {
  document.getElementById('ctx-menu').classList.remove('visible');
  ctxTargetIndex = -1;
}
function ctxAddToQueue() {
  if (ctxTargetIndex < 0) return;
  queue.push(ctxTargetIndex);
  toast(`"${tracks[ctxTargetIndex]?.name}" adicionada à fila! `);
  closeCtxMenu(); renderList();
}
function ctxPlayNext() {
  if (ctxTargetIndex < 0) return;
  queue.unshift(ctxTargetIndex);
  toast(`"${tracks[ctxTargetIndex]?.name}" vai tocar em seguida! `);
  closeCtxMenu(); renderList();
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
  document.getElementById('modal-hint').textContent  = 'Cole o link do Spotify para "' + t.name + '" e busque automaticamente a capa, nome e artista.';
  document.getElementById('modal-spotify-url').value = '';
  _modalUrlErrClear();
  document.getElementById('btn-no-data').style.display = 'none';
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-spotify-url').focus(), 100);
}
function ctxRemove() {
  if (ctxTargetIndex < 0) return;
  const i = ctxTargetIndex; closeCtxMenu();
  const t = tracks[i]; if (!t) return;
  showConfirmDelete(t.name, () => {
    const el = document.getElementById('ti-' + t.id);
    const doRemove = () => {
      if (t.blobUrl)  URL.revokeObjectURL(t.blobUrl);
      if (t.coverUrl && t.coverUrl.startsWith('blob:')) URL.revokeObjectURL(t.coverUrl);
      tracks.splice(i, 1);
      queue = queue.filter(qi => qi !== i).map(qi => qi > i ? qi - 1 : qi);
      _shufflePool = [];
      if (currentIndex === i) { clearNowPlaying(); setPlaying(false); }
      else if (currentIndex > i) currentIndex--;
      deleteTrackFromDB(t.id);
      _animatedTrackIds.delete('ti-' + t.id);
      renderList(); toast(`"${t.name}" removida.`);
    };
    if (el) {
      _trackRemoveLock = true;
      el.classList.add('track-removing');
      setTimeout(() => { _trackRemoveLock = false; doRemove(); }, 600);
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
  if (db) { try { db.close(); } catch(e) {} db = null; }
  const req = indexedDB.deleteDatabase('player_db');
  req.onsuccess = () => location.reload();
  req.onerror   = () => location.reload();
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
  queue = []; renderQueuePanel(); toast('Fila limpa.');
}
function removeFromQueue(e, qPos) {
  e.stopPropagation();
  const item = document.querySelector(`#queue-panel-list .queue-panel-item[data-qpos="${qPos}"]`);
  if (item) {
    item.classList.add('qp-removing');
    item.addEventListener('animationend', () => {
      queue.splice(qPos, 1);
      renderQueuePanel();
    }, { once: true });
  } else {
    queue.splice(qPos, 1);
    renderQueuePanel();
  }
}
function playFromQueue(qPos) {
  const trackIdx = queue[qPos]; queue.splice(qPos, 1); selectTrack(trackIdx);
}
function renderQueuePanel() {
  const list     = document.getElementById('queue-panel-list');
  const btn      = document.getElementById('btn-queue');
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
    const t = tracks[trackIdx]; if (!t) return '';
    return `<div class="queue-panel-item" data-qpos="${qPos}" onmousedown="queueItemMouseDown(event,${qPos})" onclick="playFromQueue(${qPos})">
      <span class="qp-num">${qPos + 1}</span>
      ${(t.coverUrl || t.cover) ? `<img class="qp-cover" src="${t.coverUrl || t.cover}" alt="">` : `<div class="qp-cover-ph"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`}
      <div class="qp-info"><div class="qp-name">${escHtml(t.name)}</div><div class="qp-artist">${escHtml(t.artist)}</div></div>
      <button class="qp-remove" onclick="removeFromQueue(event,${qPos})" data-tip="Remover da fila">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');
}

let _qDragSrc         = -1;
let _qDragEl          = null;
let _qDragActive      = false;
let _qDragPending     = false;
let _qDragPendingPos  = -1;
let _qDragStartX      = 0;
let _qDragStartY      = 0;
let _qDragLeftItem    = false;
const Q_DRAG_THRESHOLD = 5;

function _qInitDrag(qPos) {
  _qDragSrc     = qPos;
  _qDragEl      = document.querySelector(`#queue-panel-list .queue-panel-item[data-qpos="${qPos}"]`);
  if (_qDragEl) _qDragEl.classList.add('qp-dragging');
  _qDragActive  = true;
  _qDragPending = false;
  _autoScrollStart(document.getElementById('queue-panel-list'));
  if (!_autoScrollRAF) _autoScrollRAF = requestAnimationFrame(_autoScrollTick);
}

function queueItemMouseDown(e, qPos) {
  if (e.target.closest('.qp-drag-handle')) return;
  if (e.button !== 0) return;
  _qDragPending     = true;
  _qDragPendingPos  = qPos;
  _qDragStartX      = e.clientX;
  _qDragStartY      = e.clientY;
  _qDragLeftItem    = false;
  document.addEventListener('mousemove', _onQPendingMouseMove);
  document.addEventListener('mouseup',   _onQPendingMouseUp);
}

function _onQPendingMouseMove(e) {
  if (!_qDragPending) return;
  const dx = Math.abs(e.clientX - _qDragStartX);
  const dy = Math.abs(e.clientY - _qDragStartY);
  if (dx > Q_DRAG_THRESHOLD || dy > Q_DRAG_THRESHOLD) {
    _qDragLeftItem = true;
    _qDragPending  = false;
    document.removeEventListener('mousemove', _onQPendingMouseMove);
    document.removeEventListener('mouseup',   _onQPendingMouseUp);
    _qInitDrag(_qDragPendingPos);
    document.addEventListener('mousemove', _onQDragMouseMove);
    document.addEventListener('mouseup',   _onQDragMouseUp);
  }
}

function _onQPendingMouseUp(e) {
  _qDragPending    = false;
  _qDragPendingPos = -1;
  document.removeEventListener('mousemove', _onQPendingMouseMove);
  document.removeEventListener('mouseup',   _onQPendingMouseUp);
  if (_qDragLeftItem) {
    _qDragLeftItem = false;
    const suppress = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    document.addEventListener('click', suppress, { capture: true, once: true });
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
  document.querySelectorAll('.qp-drag-over-top,.qp-drag-over-bottom')
    .forEach(el => el.classList.remove('qp-drag-over-top','qp-drag-over-bottom'));
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
  document.removeEventListener('mouseup',   _onQDragMouseUp);

  if (_qDragEl) _qDragEl.classList.remove('qp-dragging');
  _qDragEl = null;

  document.querySelectorAll('.qp-drag-over-top,.qp-drag-over-bottom')
    .forEach(el => el.classList.remove('qp-drag-over-top','qp-drag-over-bottom'));

  const suppress = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
  document.addEventListener('click', suppress, { capture: true, once: true });

  if (_qDragSrc < 0) return;
  const target = _qGetItemAtY(e.clientY);
  if (!target) { _qDragSrc = -1; return; }
  const ti = parseInt(target.dataset.qpos);
  if (ti === _qDragSrc) { _qDragSrc = -1; return; }

  const rect   = target.getBoundingClientRect();
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
  _dragEl = document.getElementById('ti-' + tracks[index]?.id) ||
            document.querySelector(`[data-index="${index}"]`);
  if (_dragEl) _dragEl.classList.add('dragging');
  _dragActive  = true;
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
  document.addEventListener('mouseup',   _onDragMouseUp);
}

function trackItemMouseDown(e, index) {

  if (e.target.closest('.track-drag-handle')) return;

  if (e.button !== 0) return;
  _dragPending      = true;
  _dragPendingIndex = index;
  _dragStartX       = e.clientX;
  _dragStartY       = e.clientY;
  _dragLeftItem     = false;
  document.addEventListener('mousemove', _onPendingMouseMove);
  document.addEventListener('mouseup',   _onPendingMouseUp);
}

function _onPendingMouseMove(e) {
  if (!_dragPending) return;
  const dx = Math.abs(e.clientX - _dragStartX);
  const dy = Math.abs(e.clientY - _dragStartY);

  if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
    _dragLeftItem = true;

    _dragPending = false;
    document.removeEventListener('mousemove', _onPendingMouseMove);
    document.removeEventListener('mouseup',   _onPendingMouseUp);
    _initDrag(_dragPendingIndex);
    document.addEventListener('mousemove', _onDragMouseMove);
    document.addEventListener('mouseup',   _onDragMouseUp);
  }
}

function _onPendingMouseUp(e) {
  _dragPending = false;
  _dragPendingIndex = -1;
  document.removeEventListener('mousemove', _onPendingMouseMove);
  document.removeEventListener('mouseup',   _onPendingMouseUp);

  if (_dragLeftItem) {
    _dragLeftItem = false;
    const suppress = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    document.addEventListener('click', suppress, { capture: true, once: true });
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

let _autoScrollRAF   = null;
let _autoScrollEl    = null;
let _autoScrollDir   = 0;
let _autoScrollSpeed = 6;
const AUTO_SCROLL_ZONE       = 48;
const AUTO_SCROLL_SPEED_MAIN = 6;
const AUTO_SCROLL_SPEED_QUEUE = 3;

function _autoScrollStart(containerEl) {
  _autoScrollEl    = containerEl;
  _autoScrollSpeed = containerEl.id === 'queue-panel-list'
    ? AUTO_SCROLL_SPEED_QUEUE
    : AUTO_SCROLL_SPEED_MAIN;
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
  _autoScrollEl  = null;
  if (_autoScrollRAF) { cancelAnimationFrame(_autoScrollRAF); _autoScrollRAF = null; }
}

function _onDragMouseMove(e) {
  if (!_dragActive) return;
  _autoScrollUpdate(e.clientY);
  document.querySelectorAll('.drag-over-top,.drag-over-bottom')
    .forEach(el => el.classList.remove('drag-over-top','drag-over-bottom'));
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
  document.removeEventListener('mouseup',   _onDragMouseUp);

  if (_dragEl) _dragEl.classList.remove('dragging');
  _dragEl = null;

  document.querySelectorAll('.drag-over-top,.drag-over-bottom')
    .forEach(el => el.classList.remove('drag-over-top','drag-over-bottom'));

  const suppress = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
  document.addEventListener('click', suppress, { capture: true, once: true });

  if (dragSrcIndex < 0) return;

  const target = _getItemAtY(e.clientY);
  if (!target) { dragSrcIndex = -1; return; }
  const ti = parseInt(target.dataset.index);
  if (ti === dragSrcIndex) { dragSrcIndex = -1; return; }

  const rect = target.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;

  const currentId = currentIndex >= 0 ? tracks[currentIndex]?.id : null;

  const moved = tracks.splice(dragSrcIndex, 1)[0];
  let insertAt = ti;
  if (dragSrcIndex < ti) insertAt = ti - 1;
  if (!before) insertAt += 1;
  tracks.splice(insertAt, 0, moved);

  tracks.forEach((t, idx) => { t.order = idx; saveTrack(t); });
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
  const btn   = document.getElementById('btn-gear');
  const isHidden = panel.classList.contains('hidden');
  if (!forceOpen && !isHidden) { panel.classList.add('hidden'); btn.classList.remove('active'); return; }
  (async () => {
    document.getElementById('cfg-sp-cid').value     = await loadSecret('sp_cid') || '';
    document.getElementById('cfg-sp-cs').value      = await loadSecret('sp_cs')  || '';
    document.getElementById('cfg-lfm-key').value    = await loadSecret('lfm_key') || '';
    document.getElementById('cfg-lfm-secret').value = await loadSecret('lfm_secret') || '';
    updateSettingsLfmRow();
  })();
  panel.classList.remove('hidden'); btn.classList.add('active');
}
function closeSettingsPanel() {
  document.getElementById('settings-panel').classList.add('hidden');
  document.getElementById('btn-gear').classList.remove('active');
}
function saveSettingsSpotify() {
  const cid = document.getElementById('cfg-sp-cid').value.trim();
  const cs  = document.getElementById('cfg-sp-cs').value.trim();
  if (!cid || !cs) { toast('Preencha Client ID e Secret.'); return; }
  (async () => {
    await saveSecret('sp_cid', cid);
    await saveSecret('sp_cs', cs);
    spotifyToken = null;
    toast('Credenciais do Spotify salvas ✓');
  })();
}
function saveSettingsLfm() {
  const key = document.getElementById('cfg-lfm-key').value.trim();
  const sec = document.getElementById('cfg-lfm-secret').value.trim();
  if (!key || !sec) { toast('Preencha API Key e Shared Secret.'); return; }
  (async () => {
    await saveSecret('lfm_key', key);
    await saveSecret('lfm_secret', sec);
    lfmApiKey    = key;
    lfmApiSecret = sec;
    closeSettingsPanel();
    lfmUpdateStatusUI();
    await lfmStartAuthFromSettings(key, sec);
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
    document.getElementById('lfm-auth-modal').classList.remove('hidden');
  } catch(e) {
    toast('Last.fm: ' + e.message);
  }
}
function settingsLfmDisconnect() {
  removeSecret('lfm_session');
  removeSecret('lfm_user');
  localStorage.removeItem('lfm_pending_token');
  lfmSessionKey = null;
  lfmUsername   = null;
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

(function() {
  const tip = document.getElementById('custom-tooltip');
  function showTip(e, text) {
    tip.textContent = text; tip.classList.add('visible'); moveTip(e);
  }
  function moveTip(e) {
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX + 12, y = e.clientY - th - 10;
    if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 12;
    if (y < 8) y = e.clientY + 16;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    if (el.classList.contains('track-name') && el.scrollWidth <= el.clientWidth) return;
    showTip(e, el.dataset.tip);
  });
  document.addEventListener('mousemove', e => { if (tip.classList.contains('visible')) moveTip(e); });
  document.addEventListener('mouseout',  e => { if (e.target.closest('[data-tip]')) tip.classList.remove('visible'); });
  document.addEventListener('click', () => tip.classList.remove('visible'));
  const hideBothTips = () => {
    tip.classList.remove('visible');
    document.getElementById('progress-tooltip')?.classList.remove('visible');
  };
  window.addEventListener('scroll', hideBothTips, true);
})();

document.addEventListener('click', e => {
  if (!document.getElementById('ctx-menu').contains(e.target)) closeCtxMenu();
  const qw = document.querySelector('.queue-btn-wrap');
  if (qw && !qw.contains(e.target)) closeQueuePanel();
  const sw = document.getElementById('settings-wrap');
  if (sw && !sw.contains(e.target)) closeSettingsPanel();
  const fp = document.getElementById('file-picker-overlay');
  if (fp && e.target === fp) fpClose();
  const clm = document.getElementById('clear-library-modal');
  if (clm && e.target === clm) closeClearLibraryModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeCtxMenu(); closeQueuePanel(); closeSettingsPanel(); fpClose(); closeClearLibraryModal(); }
});

init();

window._restoreCursor = null;
(function() {
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
  observer.observe(document.body, { childList: true, subtree: true });

  window._restoreCursor = applyToAll;
})();

document.addEventListener('contextmenu', e => {
  if (e.target.closest('.track-item[data-index]')) return;
  e.preventDefault();
});

document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());
document.addEventListener('dragover', e => e.preventDefault());