'use strict';
/* =====================================================================
   Edit Video Affiliate — app tĩnh, HTML/CSS/JS thuần, chạy trên GitHub Pages
   Luồng: Nhập ảnh → Storyboard → Timeline & nhạc → Xuất video 9:16
   - Ảnh lưu bằng IndexedDB (blob), metadata dự án lưu localStorage.
   - API key chỉ lưu trong localStorage của trình duyệt.
   ===================================================================== */

/* ---------------- Tiện ích ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function uid() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let toastTimer = null;
function showToast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2800);
}

/* ---------------- IndexedDB (chứa ảnh + nhạc dạng blob) ---------------- */
const DB_NAME = 'eva-db';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('music')) db.createObjectStore('music', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbPut(storeName, value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbGet(storeName, id) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function idbGetAll(storeName) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

function idbDelete(storeName, id) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/* ---------------- Trạng thái ---------------- */
const LS_PROJECTS = 'eva_projects_v1';
const LS_CURRENT = 'eva_current_project_v1';
const LS_CONN = 'eva_connections_v1';
const TOPGIA_LINK = 'https://s.shopee.vn/60SurkajtJ';

const DEFAULT_CONNECTIONS = {
  aiLab: { baseUrl: 'https://www.videoslash.com/api', key: '' },
  suno: { baseUrl: 'https://api.ttapi.io', key: '' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', key: '' },
  pexels: { baseUrl: 'https://api.pexels.com/v1', key: '' }
};

let projects = [];
let current = null;              // dự án đang mở
let images = new Map();          // id -> { id, name, blob, url }
let imgCache = new Map();        // id -> HTMLImageElement đã load xong
let music = { id: null, name: '', url: null }; // nhạc của dự án đang mở
let connections = loadConnections();
let selectedSceneId = null;
let exporting = false;

function loadConnections() {
  try {
    const raw = localStorage.getItem(LS_CONN);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_CONNECTIONS));
    const saved = JSON.parse(raw);
    const merged = JSON.parse(JSON.stringify(DEFAULT_CONNECTIONS));
    for (const k of Object.keys(merged)) {
      if (saved[k]) {
        if (saved[k].baseUrl) merged[k].baseUrl = saved[k].baseUrl;
        if (saved[k].key) merged[k].key = saved[k].key;
      }
    }
    return merged;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_CONNECTIONS));
  }
}

function saveConnections() {
  localStorage.setItem(LS_CONN, JSON.stringify(connections));
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveProjects() {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
}

function newProject(name) {
  return {
    id: uid(),
    name: name || 'Dự án mới',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scenes: [], // { id, imageId, text, duration }
    product: { name: '', price: '', promo: '', link: '' },
    musicVolume: 0.8
  };
}

function saveCurrentProject() {
  if (!current) return;
  current.updatedAt = Date.now();
  const i = projects.findIndex((p) => p.id === current.id);
  if (i >= 0) projects[i] = current;
  saveProjects();
  renderProjectSelect();
}

function totalDuration() {
  if (!current) return 0;
  return current.scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

/* ---------------- Khởi động ---------------- */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindStaticEvents();
  try {
    await openDB();
    await loadImagesFromDB();
  } catch (e) {
    showToast('Không mở được bộ nhớ trình duyệt (IndexedDB): ' + e.message);
  }
  projects = loadProjects();
  if (projects.length === 0) {
    current = newProject('Video affiliate đầu tiên');
    projects.push(current);
    saveProjects();
  } else {
    const savedId = localStorage.getItem(LS_CURRENT);
    current = projects.find((p) => p.id === savedId) || projects[0];
  }
  localStorage.setItem(LS_CURRENT, current.id);
  await loadMusicForProject().catch(() => {});
  fillConnectionInputs();
  updateKeyStatuses();
  renderAll();
  drawPreviewFrame(0);
}

async function loadImagesFromDB() {
  const rows = await idbGetAll('images');
  for (const row of rows) {
    if (!row || !row.blob) continue;
    images.set(row.id, { id: row.id, name: row.name || 'Ảnh', blob: row.blob, url: URL.createObjectURL(row.blob) });
  }
}

async function loadMusicForProject() {
  const audio = $('#musicAudio');
  if (!current) { music = { id: null, name: '', url: null }; return; }
  const row = await idbGet('music', current.id);
  if (row && row.blob) {
    if (music.url) URL.revokeObjectURL(music.url);
    music = { id: row.id, name: row.name || 'Nhạc nền', url: URL.createObjectURL(row.blob) };
    audio.src = music.url;
  } else {
    music = { id: null, name: '', url: null };
    audio.removeAttribute('src');
    audio.load();
  }
  audio.volume = 1;
  setVolume(current.musicVolume == null ? 0.8 : current.musicVolume);
  const vol = $('#musicVolume');
  vol.value = current.musicVolume == null ? 0.8 : current.musicVolume;
  $('#musicVolumeLabel').textContent = Math.round(audio.volume * 100) + '%';
  $('#musicName').textContent = music.name ? '🎵 ' + music.name : 'Chưa có nhạc nền.';
}

function renderAll() {
  renderProjectSelect();
  renderLibrary();
  renderStoryboard();
  renderTimeline();
  renderProductForm();
  renderProjectList();
  updateTimeLabel(preview.offset);
}

/* ---------------- Dự án: mở / tạo / đổi tên / xóa / nhân bản ---------------- */
function renderProjectSelect() {
  const sel = $('#projectSelect');
  sel.innerHTML = projects.map((p) =>
    '<option value="' + esc(p.id) + '"' + (current && p.id === current.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'
  ).join('');
}

function renderProjectList() {
  const box = $('#projectList');
  box.innerHTML = projects.map((p) => {
    const isCurrent = current && p.id === current.id;
    const n = p.scenes.length;
    const d = new Date(p.updatedAt).toLocaleDateString('vi-VN');
    return '<div class="project-row' + (isCurrent ? ' current' : '') + '">' +
      '<span class="p-name">' + esc(p.name) + '</span>' +
      '<span class="p-meta">' + n + ' cảnh · ' + d + '</span>' +
      '<button type="button" class="btn" data-act="open" data-id="' + esc(p.id) + '">Mở</button>' +
      '<button type="button" class="btn" data-act="rename" data-id="' + esc(p.id) + '">Đổi tên</button>' +
      '<button type="button" class="btn" data-act="dup" data-id="' + esc(p.id) + '">Nhân bản</button>' +
      '<button type="button" class="btn btn-danger" data-act="del" data-id="' + esc(p.id) + '">Xóa</button>' +
      '</div>';
  }).join('') || '<p class="hint">Chưa có dự án nào.</p>';
}

async function switchProject(id) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  pausePreview();
  current = p;
  localStorage.setItem(LS_CURRENT, current.id);
  selectedSceneId = null;
  preview.offset = 0;
  await loadMusicForProject();
  renderAll();
  drawPreviewFrame(0);
}

async function createProject(name) {
  const p = newProject(name);
  projects.push(p);
  saveProjects();
  await switchProject(p.id);
  showToast('Đã tạo dự án “' + p.name + '”.');
}

function duplicateProject(id) {
  const src = projects.find((p) => p.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.name = src.name + ' (bản sao)';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.scenes = copy.scenes.map((s) => ({ ...s, id: uid() }));
  projects.push(copy);
  saveProjects();
  renderProjectList();
  renderProjectSelect();
  showToast('Đã nhân bản dự án.');
}

async function deleteProject(id) {
  if (projects.length <= 1) {
    showToast('Phải giữ lại ít nhất 1 dự án.');
    return;
  }
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  if (!window.confirm('Xóa dự án “' + p.name + '” và toàn bộ cảnh của nó? Ảnh trong thư viện vẫn giữ nguyên.')) return;
  projects = projects.filter((x) => x.id !== id);
  await idbDelete('music', id);
  saveProjects();
  if (current && current.id === id) {
    await switchProject(projects[0].id);
  } else {
    renderProjectList();
    renderProjectSelect();
  }
  showToast('Đã xóa dự án “' + p.name + '”.');
}

/* ---------------- Thư viện ảnh ---------------- */
async function addImageBlob(blob, name) {
  if (!blob || !blob.type || blob.type.indexOf('image/') !== 0) {
    showToast('File này không phải ảnh.');
    return null;
  }
  const id = uid();
  const rec = { id, name: name || 'Ảnh', blob };
  await idbPut('images', rec);
  images.set(id, { id, name: rec.name, blob, url: URL.createObjectURL(blob) });
  renderLibrary();
  return id;
}

function renderLibrary() {
  const grid = $('#imageGrid');
  const list = Array.from(images.values());
  $('#imageCount').textContent = String(list.length);
  $('#libraryEmpty').style.display = list.length ? 'none' : '';
  grid.innerHTML = list.map((im) =>
    '<div class="image-card" data-id="' + esc(im.id) + '">' +
      '<img src="' + esc(im.url) + '" alt="' + esc(im.name) + '" loading="lazy">' +
      '<div class="img-name">' + esc(im.name) + '</div>' +
      '<div class="img-actions">' +
        '<button type="button" class="btn btn-primary" data-act="add-scene">＋ Storyboard</button>' +
        '<button type="button" class="btn btn-danger" data-act="del">Xóa</button>' +
      '</div>' +
    '</div>'
  ).join('');
  const sel = $('#addSceneImage');
  sel.innerHTML = list.map((im) =>
    '<option value="' + esc(im.id) + '">' + esc(im.name) + '</option>'
  ).join('');
}

async function deleteImage(id) {
  const used = current ? current.scenes.filter((s) => s.imageId === id).length : 0;
  const im = images.get(id);
  const msg = used > 0
    ? 'Xóa ảnh “' + (im ? im.name : '') + '” và ' + used + ' cảnh đang dùng ảnh này?'
    : 'Xóa ảnh “' + (im ? im.name : '') + '” khỏi thư viện?';
  if (!window.confirm(msg)) return;
  if (current && used > 0) {
    current.scenes = current.scenes.filter((s) => s.imageId !== id);
    saveCurrentProject();
    renderStoryboard();
    renderTimeline();
  }
  if (im) URL.revokeObjectURL(im.url);
  images.delete(id);
  imgCache.delete(id);
  await idbDelete('images', id);
  renderLibrary();
  drawPreviewFrame(preview.offset);
  showToast('Đã xóa ảnh.');
}

async function addImageFromUrl(url) {
  url = (url || '').trim();
  if (!url) { showToast('Bạn chưa dán link ảnh.'); return; }
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Máy chủ ảnh trả về lỗi ' + res.status);
    const blob = await res.blob();
    let name = url.split('/').pop().split('?')[0] || 'Ảnh từ link';
    try { name = decodeURIComponent(name); } catch (e) { /* giữ nguyên tên gốc */ }
    const id = await addImageBlob(blob, name);
    if (id) showToast('Đã thêm ảnh từ link.');
  } catch (e) {
    showToast('Không tải được ảnh từ link này (có thể do máy chủ ảnh chặn tải ngoài). Hãy tải ảnh về máy rồi kéo thả vào app.');
  }
}

function handleFiles(files) {
  const arr = Array.from(files || []).filter((f) => f.type && f.type.indexOf('image/') === 0);
  if (arr.length === 0) { showToast('Không có file ảnh nào trong lựa chọn.'); return; }
  let done = 0;
  arr.forEach((f) => {
    addImageBlob(f, f.name).then(() => {
      done += 1;
      if (done === arr.length) showToast('Đã thêm ' + done + ' ảnh vào thư viện.');
    }).catch((e) => showToast('Lỗi khi thêm ảnh: ' + e.message));
  });
}

/* ---------------- Tìm ảnh stock — Pexels ---------------- */
function pexelsKeyMissing() {
  const el = $('#pexelsKeyStatus');
  el.textContent = 'Chưa nối key Pexels — mục này không bắt buộc, đưa ảnh của bạn vào ở trên là đủ dùng. Khi nào cần thì bấm “Kết nối” ở góc trên để nhập key.';
  el.classList.add('warn');
}

async function searchPexels() {
  const key = (connections.pexels.key || '').trim();
  if (!key) { pexelsKeyMissing(); showToast('Mục này cần key Pexels mới tìm được. Bạn cứ đưa ảnh của mình vào là đủ dùng.'); return; }
  const q = $('#pexelsQuery').value.trim();
  if (!q) { showToast('Nhập từ khóa cần tìm, ví dụ: máy xay sinh tố.'); return; }
  const box = $('#pexelsResults');
  box.innerHTML = '<p class="hint">Đang tìm trên Pexels...</p>';
  try {
    const base = (connections.pexels.baseUrl || 'https://api.pexels.com/v1').replace(/\/$/, '');
    const res = await fetch(base + '/search?query=' + encodeURIComponent(q) + '&per_page=12&orientation=portrait', {
      headers: { Authorization: key }
    });
    if (!res.ok) throw new Error('Pexels trả về lỗi ' + res.status);
    const data = await res.json();
    const photos = data.photos || [];
    if (photos.length === 0) {
      box.innerHTML = '<p class="hint">Không tìm thấy ảnh nào cho từ khóa này.</p>';
      return;
    }
    box.innerHTML = photos.map((ph) =>
      '<img src="' + esc(ph.src.medium) + '" data-full="' + esc(ph.src.large2x || ph.src.large) + '" ' +
      'alt="' + esc(ph.alt || 'Ảnh Pexels') + '" title="Bấm để thêm ảnh này vào thư viện (ảnh của ' + esc(ph.photographer || '') + ')">'
    ).join('');
  } catch (e) {
    box.innerHTML = '<p class="hint">Tìm ảnh thất bại: ' + esc(e.message) + '. Kiểm tra lại key Pexels trong mục Kết nối.</p>';
  }
}

/* ---------------- Tạo ảnh từ mô tả — OpenRouter ---------------- */
function orKeyMissing() {
  const el = $('#orKeyStatus');
  el.textContent = 'Chưa nối key OpenRouter — mục này không bắt buộc, đưa ảnh của bạn vào ở trên là đủ dùng. Khi nào cần thì bấm “Kết nối” ở góc trên để nhập key.';
  el.classList.add('warn');
}

async function generateImage() {
  const key = (connections.openrouter.key || '').trim();
  if (!key) { orKeyMissing(); showToast('Mục này cần key OpenRouter mới tạo được. Bạn cứ đưa ảnh của mình vào là đủ dùng.'); return; }
  const prompt = $('#genPrompt').value.trim();
  if (!prompt) { showToast('Nhập mô tả ảnh cần tạo trước đã.'); return; }
  const model = $('#genModel').value.trim() || 'google/gemini-2.5-flash-image';
  const box = $('#genResult');
  box.innerHTML = '<p class="hint">Đang tạo ảnh, chờ một lát...</p>';
  try {
    const base = (connections.openrouter.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const res = await fetch(base + '/images/generations', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.href,
        'X-Title': 'Edit Video Affiliate'
      },
      body: JSON.stringify({ model, prompt })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || ('OpenRouter trả về lỗi ' + res.status);
      throw new Error(msg);
    }
    const item = data && data.data && data.data[0];
    if (!item) throw new Error('OpenRouter không trả về ảnh.');
    let blob = null;
    if (item.b64_json) {
      const bin = atob(item.b64_json);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: 'image/png' });
    } else if (item.url) {
      const r2 = await fetch(item.url);
      if (!r2.ok) throw new Error('Không tải được ảnh vừa tạo (lỗi ' + r2.status + ').');
      blob = await r2.blob();
    } else {
      throw new Error('OpenRouter trả về kết quả không có ảnh.');
    }
    const id = await addImageBlob(blob, 'Ảnh AI: ' + prompt.slice(0, 40));
    if (id) {
      box.innerHTML = '<p class="hint">Đã tạo xong và thêm vào thư viện. Bấm “＋ Storyboard” trên ảnh để đưa vào cảnh.</p>';
      showToast('Đã tạo ảnh xong.');
    }
  } catch (e) {
    box.innerHTML = '<p class="hint">Tạo ảnh thất bại: ' + esc(e.message) + '</p>';
  }
}

/* ---------------- Storyboard ---------------- */
function addScene(imageId) {
  if (!current) return;
  if (!images.has(imageId)) { showToast('Chọn một ảnh trong thư viện trước đã.'); return; }
  current.scenes.push({ id: uid(), imageId, text: '', duration: 3 });
  saveCurrentProject();
  renderStoryboard();
  renderTimeline();
  drawPreviewFrame(preview.offset);
}

function renderStoryboard() {
  const list = $('#sceneList');
  const scenes = current ? current.scenes : [];
  $('#storyboardEmpty').style.display = scenes.length ? 'none' : '';
  list.innerHTML = scenes.map((s, i) => {
    const im = images.get(s.imageId);
    const thumb = im ? im.url : '';
    const alt = im ? esc(im.name) : 'Ảnh đã xóa';
    return '<div class="scene-card" draggable="true" data-id="' + esc(s.id) + '">' +
      '<img class="scene-thumb" src="' + esc(thumb) + '" alt="' + alt + '">' +
      '<div class="scene-body">' +
        '<div class="scene-meta"><strong>Cảnh ' + (i + 1) + '</strong><span class="hint">' + alt + '</span></div>' +
        '<input type="text" data-field="text" data-id="' + esc(s.id) + '" value="' + esc(s.text) + '" placeholder="Chữ / thoại của cảnh này...">' +
        '<div class="scene-meta">' +
          '<label>Thời lượng (giây) <input type="number" data-field="duration" data-id="' + esc(s.id) + '" min="1" max="30" step="0.5" value="' + esc(s.duration) + '"></label>' +
        '</div>' +
      '</div>' +
      '<div class="scene-actions">' +
        '<button type="button" class="btn" data-act="up" data-id="' + esc(s.id) + '" title="Lên trên">↑</button>' +
        '<button type="button" class="btn" data-act="down" data-id="' + esc(s.id) + '" title="Xuống dưới">↓</button>' +
        '<button type="button" class="btn btn-danger" data-act="del" data-id="' + esc(s.id) + '" title="Xóa cảnh">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function moveScene(id, dir) {
  if (!current) return;
  const i = current.scenes.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= current.scenes.length) return;
  const tmp = current.scenes[i];
  current.scenes[i] = current.scenes[j];
  current.scenes[j] = tmp;
  saveCurrentProject();
  renderStoryboard();
  renderTimeline();
}

function deleteScene(id) {
  if (!current) return;
  current.scenes = current.scenes.filter((s) => s.id !== id);
  if (selectedSceneId === id) selectedSceneId = null;
  saveCurrentProject();
  renderStoryboard();
  renderTimeline();
  drawPreviewFrame(preview.offset);
}

/* ---------------- Vẽ khung hình (dùng chung cho xem trước và xuất) ---------------- */
function sceneAtTime(t) {
  const scenes = current ? current.scenes : [];
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const d = Number(scenes[i].duration) || 0;
    if (t < acc + d || i === scenes.length - 1) {
      return { scene: scenes[i], index: i, local: Math.max(0, t - acc) };
    }
    acc += d;
  }
  return null;
}

async function getImageEl(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  const rec = images.get(id);
  if (!rec) return null;
  const img = new Image();
  img.src = rec.url;
  try {
    await img.decode();
  } catch (e) {
    await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
  }
  imgCache.set(id, img);
  return img;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapTextLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawOverlayText(ctx, text, W, H) {
  const hasProduct = current && current.product && (current.product.name || current.product.promo);
  const bottomPad = hasProduct ? 300 : 170;
  ctx.save();
  ctx.font = '700 46px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const maxWidth = W * 0.88;
  const lines = wrapTextLines(ctx, text, maxWidth);
  const lineHeight = 58;
  let y = H - bottomPad - (lines.length - 1) * lineHeight;
  ctx.lineJoin = 'round';
  for (const ln of lines) {
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 9;
    ctx.strokeText(ln, W / 2, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(ln, W / 2, y);
    y += lineHeight;
  }
  ctx.restore();
}

function drawProductBar(ctx, W, H) {
  const p = current ? current.product : null;
  if (!p || (!p.name && !p.promo)) return;
  ctx.save();
  const x = 24, w = W - 48, h = 132, y = H - 156;
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (p.name) {
    ctx.font = '700 34px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('🛒 ' + p.name, x + 24, y + 36, w - 48);
  }
  if (p.promo) {
    ctx.font = '700 42px sans-serif';
    ctx.fillStyle = '#ffd43b';
    const priceText = 'Giá KM: ' + p.promo + (p.price ? '  (gốc ' + p.price + ')' : '');
    ctx.fillText(priceText, x + 24, y + 92, w - 48);
  }
  ctx.restore();
}

async function drawScene(ctx, scene, index, localT, W, H) {
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, W, H);
  const img = await getImageEl(scene.imageId);
  if (img && img.naturalWidth > 0) {
    const d = Number(scene.duration) || 1;
    const p = Math.min(1, Math.max(0, localT / d));
    const zoomIn = index % 2 === 0;
    const zoom = zoomIn ? 1.06 + 0.14 * p : 1.20 - 0.14 * p;
    const panX = (zoomIn ? 1 : -1) * (p - 0.5) * 0.10;
    const panY = (index % 3 === 0 ? 1 : -1) * (p - 0.5) * 0.06;
    const base = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * base * zoom;
    const dh = img.naturalHeight * base * zoom;
    const dx = (W - dw) / 2 + panX * (dw - W) / 2;
    const dy = (H - dh) / 2 + panY * (dh - H) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Ảnh đã xóa', W / 2, H / 2);
  }
  const text = (scene.text || '').trim();
  if (text) drawOverlayText(ctx, text, W, H);
  drawProductBar(ctx, W, H);
}

/* ---------------- Xem trước ---------------- */
const preview = { playing: false, offset: 0, raf: 0, lastStamp: 0 };
let previewToken = 0;

async function drawPreviewFrame(t) {
  const token = ++previewToken;
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d');
  const total = totalDuration();
  if (!current || current.scenes.length === 0 || total <= 0) {
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 720, 1280);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Chưa có cảnh nào', 360, 640);
    updateTimeLabel(0);
    updateProgress(0);
    return;
  }
  const found = sceneAtTime(Math.min(t, total - 0.01));
  if (!found) return;
  await drawScene(ctx, found.scene, found.index, found.local, 720, 1280);
  if (token !== previewToken) return;
  updateTimeLabel(t);
  updateProgress(t);
}

function updateTimeLabel(t) {
  $('#timeLabel').textContent = fmtTime(t) + ' / ' + fmtTime(totalDuration());
}

function updateProgress(t) {
  const total = totalDuration();
  $('#progressFill').style.width = total > 0 ? Math.min(100, (t / total) * 100) + '%' : '0%';
}

function playPreview() {
  if (!current || current.scenes.length === 0) {
    showToast('Chưa có cảnh nào để xem trước. Thêm cảnh ở bước Storyboard trước.');
    return;
  }
  const total = totalDuration();
  if (total <= 0) { showToast('Thời lượng video đang bằng 0.'); return; }
  if (preview.offset >= total) preview.offset = 0;
  ensureAudioGraph();
  const audio = $('#musicAudio');
  if (music.url) {
    audio.currentTime = Math.min(preview.offset, (audio.duration || 0));
    audio.play().catch(() => {});
  }
  preview.playing = true;
  preview.lastStamp = performance.now();
  $('#btnPlay').textContent = '⏸ Tạm dừng';
  cancelAnimationFrame(preview.raf);
  preview.raf = requestAnimationFrame(tickPreview);
}

function tickPreview(now) {
  if (!preview.playing) return;
  const dt = (now - preview.lastStamp) / 1000;
  preview.lastStamp = now;
  preview.offset += dt;
  const total = totalDuration();
  if (preview.offset >= total) {
    preview.offset = total;
    drawPreviewFrame(preview.offset);
    pausePreview();
    return;
  }
  drawPreviewFrame(preview.offset);
  preview.raf = requestAnimationFrame(tickPreview);
}

function pausePreview() {
  preview.playing = false;
  cancelAnimationFrame(preview.raf);
  $('#musicAudio').pause();
  $('#btnPlay').textContent = '▶ Phát xem trước';
}

/* ---------------- Timeline ---------------- */
function renderTimeline() {
  const track = $('#timelineTrack');
  const scenes = current ? current.scenes : [];
  $('#timelineEmpty').style.display = scenes.length ? 'none' : '';
  track.innerHTML = scenes.map((s, i) => {
    const im = images.get(s.imageId);
    const dur = Number(s.duration) || 0;
    const w = Math.max(56, Math.round(dur * 28));
    return '<div class="clip' + (selectedSceneId === s.id ? ' selected' : '') + '" draggable="true" data-id="' + esc(s.id) + '" style="width:' + w + 'px" title="Cảnh ' + (i + 1) + ' — ' + esc(s.duration) + 's">' +
      (im ? '<img src="' + esc(im.url) + '" alt="">' : '<img alt="">') +
      '<div class="clip-label">C' + (i + 1) + ' · ' + esc(s.duration) + 's</div>' +
    '</div>';
  }).join('');
}

function selectScene(id) {
  selectedSceneId = id;
  const s = current ? current.scenes.find((x) => x.id === id) : null;
  if (!s) {
    $('#clipEditor').hidden = true;
    renderTimeline();
    return;
  }
  const idx = current.scenes.indexOf(s);
  $('#clipInfo').textContent = 'Cảnh ' + (idx + 1);
  $('#clipDuration').value = s.duration;
  $('#clipText').value = s.text || '';
  $('#clipEditor').hidden = false;
  renderTimeline();
}

function moveSceneTo(id, beforeId) {
  if (!current || id === beforeId) return;
  const from = current.scenes.findIndex((s) => s.id === id);
  if (from < 0) return;
  const [moved] = current.scenes.splice(from, 1);
  if (!beforeId) {
    current.scenes.push(moved);
  } else {
    const to = current.scenes.findIndex((s) => s.id === beforeId);
    current.scenes.splice(to < 0 ? current.scenes.length : to, 0, moved);
  }
  saveCurrentProject();
  renderStoryboard();
  renderTimeline();
}

/* ---------------- Nhạc nền ---------------- */
let audioGraph = null;

function ensureAudioGraph() {
  if (audioGraph) return audioGraph;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    const ctx = new AudioCtx();
    const el = $('#musicAudio');
    el.volume = 1;
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    gain.value = current ? (current.musicVolume == null ? 0.8 : current.musicVolume) : 0.8;
    src.connect(gain);
    gain.connect(dest);
    gain.connect(ctx.destination);
    audioGraph = { ctx, gain, dest };
    return audioGraph;
  } catch (e) {
    return null;
  }
}

function setVolume(v) {
  const audio = $('#musicAudio');
  if (audioGraph) {
    audioGraph.gain.value = v;
    audio.volume = 1;
  } else {
    audio.volume = v;
  }
  $('#musicVolumeLabel').textContent = Math.round(v * 100) + '%';
}

async function saveMusicBlob(blob, name) {
  if (!current) return;
  const rec = { id: current.id, name: name || 'Nhạc nền', blob };
  await idbPut('music', rec);
  if (music.url) URL.revokeObjectURL(music.url);
  music = { id: rec.id, name: rec.name, url: URL.createObjectURL(blob) };
  const audio = $('#musicAudio');
  audio.src = music.url;
  setVolume(current.musicVolume == null ? 0.8 : current.musicVolume);
  $('#musicName').textContent = '🎵 ' + music.name;
  showToast('Đã thêm nhạc nền: ' + music.name);
}

async function removeMusic() {
  if (!current) return;
  pausePreview();
  await idbDelete('music', current.id);
  if (music.url) URL.revokeObjectURL(music.url);
  music = { id: null, name: '', url: null };
  const audio = $('#musicAudio');
  audio.removeAttribute('src');
  audio.load();
  $('#musicName').textContent = 'Chưa có nhạc nền.';
  showToast('Đã gỡ nhạc nền.');
}

/* ---------------- Thẻ sản phẩm ---------------- */
function renderProductForm() {
  const p = current ? current.product : { name: '', price: '', promo: '', link: '' };
  $('#productName').value = p.name || '';
  $('#productPrice').value = p.price || '';
  $('#productPromo').value = p.promo || '';
  $('#productLink').value = p.link || '';
}

/* ---------------- Caption Facebook ---------------- */
function buildCaption() {
  const p = current ? current.product : {};
  const hook = current && current.scenes[0] ? (current.scenes[0].text || '').trim() : '';
  const lines = [];
  lines.push(hook || 'Video mới của mình đây cả nhà ơi!');
  lines.push('');
  if (p.name) lines.push('🛒 ' + p.name);
  if (p.promo) lines.push('💰 Giá khuyến mãi: ' + p.promo + (p.price ? ' (giá gốc ' + p.price + ')' : ''));
  else if (p.price) lines.push('💰 Giá: ' + p.price);
  if (p.link) lines.push('👉 Link mua: ' + p.link);
  lines.push('');
  lines.push('Cả nhà thấy sao? Bình luận cho mình biết nha!');
  lines.push('');
  lines.push('#xuhuong #cute #baby');
  lines.push('Link TopGia: ' + TOPGIA_LINK);
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------------- Xuất video ---------------- */
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* bỏ qua */ }
  }
  return null;
}

async function exportVideo() {
  if (exporting) return;
  if (!current || current.scenes.length === 0) {
    showToast('Chưa có cảnh nào để xuất. Thêm cảnh ở bước Storyboard trước.');
    return;
  }
  const total = totalDuration();
  if (total <= 0) { showToast('Thời lượng video đang bằng 0.'); return; }
  const mime = pickMimeType();
  if (!mime) {
    showToast('Trình duyệt này không hỗ trợ xuất video WebM. Hãy dùng Chrome hoặc Edge bản mới.');
    return;
  }
  if (typeof HTMLCanvasElement === 'undefined' || !document.createElement('canvas').captureStream) {
    showToast('Trình duyệt này không hỗ trợ quay màn hình canvas (captureStream).');
    return;
  }
  exporting = true;
  pausePreview();
  $('#btnExport').disabled = true;
  $('#exportProgress').hidden = false;
  $('#exportFill').style.width = '0%';
  $('#downloadVideo').hidden = true;
  $('#exportStatus').textContent = 'Đang chuẩn bị xuất video...';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const tracks = Array.from(stream.getVideoTracks());
    let graph = null;
    const audio = $('#musicAudio');
    if (music.url) {
      graph = ensureAudioGraph();
      if (graph) {
        await graph.ctx.resume().catch(() => {});
        tracks.push.apply(tracks, Array.from(graph.dest.stream.getAudioTracks()));
      } else {
        showToast('Không gắn được nhạc vào video trên trình duyệt này — video xuất ra sẽ không có nhạc.');
      }
    }
    const combined = new MediaStream(tracks);
    const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start(250);
    if (music.url && graph) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    const fps = 30;
    const frames = Math.round(total * fps);
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const found = sceneAtTime(t);
      if (found) await drawScene(ctx, found.scene, found.index, found.local, 720, 1280);
      const pct = Math.round(((f + 1) / frames) * 100);
      $('#exportFill').style.width = pct + '%';
      $('#exportStatus').textContent = 'Đang xuất video... ' + pct + '% (video ' + fmtTime(total) + ' thì mất khoảng ' + fmtTime(total) + ')';
      await sleep(33);
    }
    await sleep(400);
    if (music.url) audio.pause();
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const link = $('#downloadVideo');
    link.href = url;
    link.download = (current.name || 'video-affiliate').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-') + '.webm';
    link.hidden = false;
    $('#exportStatus').textContent = 'Xuất xong! Video dạng WebM, 720×1280, dài ' + fmtTime(total) + '. Bấm nút tải bên dưới để lưu file.';
    showToast('Xuất video xong.');
  } catch (e) {
    $('#exportStatus').textContent = 'Xuất video thất bại: ' + e.message;
  } finally {
    exporting = false;
    $('#btnExport').disabled = false;
    $('#exportProgress').hidden = true;
  }
}

/* ---------------- Kết nối API ---------------- */
function fillConnectionInputs() {
  $('#aiBase').value = connections.aiLab.baseUrl;
  $('#aiKey').value = connections.aiLab.key;
  $('#sunoBase').value = connections.suno.baseUrl;
  $('#sunoKey').value = connections.suno.key;
  $('#orBase').value = connections.openrouter.baseUrl;
  $('#orKey').value = connections.openrouter.key;
  $('#pexelsKey').value = connections.pexels.key;
}

function setConnStatus(el, kind, msg) {
  el.textContent = msg;
  el.classList.remove('ok', 'bad', 'warn');
  if (kind) el.classList.add(kind);
}

function updateKeyStatuses() {
  const px = $('#pexelsKeyStatus');
  if ((connections.pexels.key || '').trim()) {
    px.textContent = 'Đã nối key Pexels.';
    px.classList.remove('warn');
  } else {
    px.textContent = 'Chưa nối key — không bắt buộc, đưa ảnh của bạn vào là đủ dùng.';
    px.classList.add('warn');
  }
  const or = $('#orKeyStatus');
  if ((connections.openrouter.key || '').trim()) {
    or.textContent = 'Đã nối key OpenRouter.';
    or.classList.remove('warn');
  } else {
    or.textContent = 'Chưa nối key — không bắt buộc, đưa ảnh của bạn vào là đủ dùng.';
    or.classList.add('warn');
  }
}

async function checkAiLab() {
  const key = (connections.aiLab.key || '').trim();
  const base = (connections.aiLab.baseUrl || 'https://www.videoslash.com/api').replace(/\/$/, '');
  const statusEl = $('#aiStatus');
  const toolsEl = $('#aiTools');
  if (!key) { setConnStatus(statusEl, 'warn', 'Chưa nhập key.'); return; }
  setConnStatus(statusEl, '', 'Đang kiểm tra...');
  try {
    const res = await fetch(base + '/v1/credits', { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) throw new Error('Máy chủ trả về lỗi ' + res.status + (res.status === 402 ? ' — tài khoản cần gói đăng ký đang hoạt động' : ''));
    const data = await res.json().catch(() => ({}));
    setConnStatus(statusEl, 'ok', 'Đã nối AI Lab. ' + (data.credits != null ? 'Số credit còn: ' + data.credits + '.' : 'Key hợp lệ.'));
    try {
      const r2 = await fetch(base + '/v1/ai-lab/tools', { headers: { Authorization: 'Bearer ' + key } });
      if (r2.ok) {
        const t = await r2.json();
        const names = (Array.isArray(t) ? t : (t.tools || [])).map((x) => x.title || x.id).filter(Boolean);
        if (names.length) toolsEl.textContent = 'Công cụ có sẵn: ' + names.join(', ') + '.';
      }
    } catch (e) { /* không liệt kê được công cụ thì thôi, key vẫn đã nối */ }
  } catch (e) {
    setConnStatus(statusEl, 'bad', 'Chưa nối được: ' + e.message);
  }
}

async function checkSuno() {
  const key = (connections.suno.key || '').trim();
  const base = (connections.suno.baseUrl || 'https://api.ttapi.io').replace(/\/$/, '');
  const statusEl = $('#sunoStatus');
  if (!key) { setConnStatus(statusEl, 'warn', 'Chưa nhập key.'); return; }
  setConnStatus(statusEl, '', 'Đang kiểm tra...');
  try {
    const res = await fetch(base + '/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    if (res.ok) {
      setConnStatus(statusEl, 'ok', 'Đã nối Suno (qua nhà cung cấp ' + base + ').');
      return;
    }
    const res2 = await fetch(base + '/', { method: 'GET' });
    if (res2.status) {
      setConnStatus(statusEl, 'warn', 'Máy chủ phản hồi (mã ' + res2.status + ') nhưng endpoint kiểm tra không khớp — kiểm tra lại base URL của nhà cung cấp Suno.');
      return;
    }
    throw new Error('Máy chủ trả về lỗi ' + res.status);
  } catch (e) {
    setConnStatus(statusEl, 'bad', 'Chưa nối được: ' + e.message + ' Kiểm tra lại base URL và key.');
  }
}

async function checkOpenRouter() {
  const key = (connections.openrouter.key || '').trim();
  const base = (connections.openrouter.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const statusEl = $('#orStatus');
  if (!key) { setConnStatus(statusEl, 'warn', 'Chưa nhập key.'); return; }
  setConnStatus(statusEl, '', 'Đang kiểm tra...');
  try {
    const res = await fetch(base + '/auth/key', { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) throw new Error('Máy chủ trả về lỗi ' + res.status + ' — key có thể sai hoặc đã hết hạn.');
    const data = await res.json().catch(() => ({}));
    const label = (data.data && data.data.label) ? ' (' + data.data.label + ')' : '';
    setConnStatus(statusEl, 'ok', 'Đã nối OpenRouter' + label + '.');
  } catch (e) {
    setConnStatus(statusEl, 'bad', 'Chưa nối được: ' + e.message);
  }
}

async function checkPexels() {
  const key = (connections.pexels.key || '').trim();
  const base = (connections.pexels.baseUrl || 'https://api.pexels.com/v1').replace(/\/$/, '');
  const statusEl = $('#pexelsStatus');
  if (!key) { setConnStatus(statusEl, 'warn', 'Chưa nhập key.'); return; }
  setConnStatus(statusEl, '', 'Đang kiểm tra...');
  try {
    const res = await fetch(base + '/curated?per_page=1', { headers: { Authorization: key } });
    if (!res.ok) throw new Error('Máy chủ trả về lỗi ' + res.status + ' — key có thể sai.');
    setConnStatus(statusEl, 'ok', 'Đã nối Pexels.');
  } catch (e) {
    setConnStatus(statusEl, 'bad', 'Chưa nối được: ' + e.message);
  }
}

/* ---------------- Modal ---------------- */
function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }

/* ---------------- Chuyển bước ---------------- */
function switchStep(name) {
  $$('.step-tab').forEach((b) => b.classList.toggle('active', b.dataset.step === name));
  $$('.step-panel').forEach((p) => p.classList.toggle('active', p.id === 'step-' + name));
  if (name === 'timeline') drawPreviewFrame(preview.offset);
  if (name === 'export') renderProductForm();
}

/* ---------------- Gắn sự kiện ---------------- */
function bindStaticEvents() {
  $$('.step-tab').forEach((b) => b.addEventListener('click', () => switchStep(b.dataset.step)));

  /* --- Bước 1: nhập ảnh --- */
  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
  $('#btnAddUrl').addEventListener('click', () => {
    addImageFromUrl($('#urlInput').value);
    $('#urlInput').value = '';
  });
  $('#urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addImageFromUrl($('#urlInput').value); $('#urlInput').value = ''; }
  });
  $('#imageGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = e.target.closest('.image-card');
    if (!card) return;
    const id = card.dataset.id;
    if (btn.dataset.act === 'add-scene') {
      addScene(id);
      showToast('Đã thêm ảnh vào storyboard.');
    } else if (btn.dataset.act === 'del') {
      deleteImage(id);
    }
  });

  /* --- Tìm / tạo ảnh --- */
  $('#btnSearchPexels').addEventListener('click', searchPexels);
  $('#pexelsQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchPexels(); });
  $('#pexelsResults').addEventListener('click', (e) => {
    const img = e.target.closest('img[data-full]');
    if (!img) return;
    addImageFromUrl(img.dataset.full);
  });
  $('#btnGenerateImage').addEventListener('click', generateImage);

  /* --- Bước 2: storyboard --- */
  $('#btnAddScene').addEventListener('click', () => {
    const sel = $('#addSceneImage');
    if (!sel.value) { showToast('Thư viện chưa có ảnh nào. Thêm ảnh ở bước 1 trước.'); return; }
    addScene(sel.value);
  });
  const sceneList = $('#sceneList');
  sceneList.addEventListener('input', (e) => {
    const f = e.target.closest('[data-field]');
    if (!f || !current) return;
    const s = current.scenes.find((x) => x.id === f.dataset.id);
    if (!s) return;
    if (f.dataset.field === 'text') {
      s.text = f.value;
      saveCurrentProject();
      drawPreviewFrame(preview.offset);
    }
  });
  sceneList.addEventListener('change', (e) => {
    const f = e.target.closest('[data-field]');
    if (!f || !current) return;
    const s = current.scenes.find((x) => x.id === f.dataset.id);
    if (!s) return;
    if (f.dataset.field === 'duration') {
      const v = Math.min(30, Math.max(1, parseFloat(f.value) || 3));
      s.duration = v;
      f.value = v;
      saveCurrentProject();
      renderTimeline();
      drawPreviewFrame(preview.offset);
    }
  });
  sceneList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'up') moveScene(id, -1);
    else if (btn.dataset.act === 'down') moveScene(id, 1);
    else if (btn.dataset.act === 'del') {
      if (window.confirm('Xóa cảnh này?')) deleteScene(id);
    }
  });
  let dragSceneId = null;
  sceneList.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.scene-card');
    if (!card) return;
    dragSceneId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSceneId);
  });
  sceneList.addEventListener('dragover', (e) => {
    const card = e.target.closest('.scene-card');
    if (!card || !dragSceneId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  sceneList.addEventListener('drop', (e) => {
    const card = e.target.closest('.scene-card');
    if (!card || !dragSceneId) return;
    e.preventDefault();
    moveSceneTo(dragSceneId, card.dataset.id);
  });
  sceneList.addEventListener('dragend', () => {
    dragSceneId = null;
    $$('.scene-card.dragging').forEach((c) => c.classList.remove('dragging'));
  });

  /* --- Bước 3: timeline & nhạc --- */
  $('#btnPlay').addEventListener('click', () => {
    if (preview.playing) pausePreview();
    else playPreview();
  });
  $('#progressBar').addEventListener('click', (e) => {
    const total = totalDuration();
    if (total <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    preview.offset = ratio * total;
    const audio = $('#musicAudio');
    if (music.url) audio.currentTime = Math.min(preview.offset, audio.duration || 0);
    drawPreviewFrame(preview.offset);
  });
  const track = $('#timelineTrack');
  track.addEventListener('click', (e) => {
    const clip = e.target.closest('.clip');
    if (clip) selectScene(clip.dataset.id);
  });
  let dragClipId = null;
  track.addEventListener('dragstart', (e) => {
    const clip = e.target.closest('.clip');
    if (!clip) return;
    dragClipId = clip.dataset.id;
    clip.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragClipId);
  });
  track.addEventListener('dragover', (e) => {
    const clip = e.target.closest('.clip');
    if (!clip || !dragClipId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  track.addEventListener('drop', (e) => {
    const clip = e.target.closest('.clip');
    if (!clip || !dragClipId) return;
    e.preventDefault();
    moveSceneTo(dragClipId, clip.dataset.id);
  });
  track.addEventListener('dragend', () => {
    dragClipId = null;
    $$('.clip.dragging').forEach((c) => c.classList.remove('dragging'));
  });
  $('#clipDuration').addEventListener('input', () => {
    const s = current && current.scenes.find((x) => x.id === selectedSceneId);
    if (!s) return;
    const v = Math.min(30, Math.max(1, parseFloat($('#clipDuration').value) || 3));
    s.duration = v;
    saveCurrentProject();
    renderTimeline();
    renderStoryboard();
    drawPreviewFrame(preview.offset);
  });
  $('#clipText').addEventListener('input', () => {
    const s = current && current.scenes.find((x) => x.id === selectedSceneId);
    if (!s) return;
    s.text = $('#clipText').value;
    saveCurrentProject();
    renderStoryboard();
    drawPreviewFrame(preview.offset);
  });
  $('#btnDeleteClip').addEventListener('click', () => {
    if (selectedSceneId && window.confirm('Xóa clip này khỏi timeline?')) deleteScene(selectedSceneId);
  });
  $('#btnPickMusic').addEventListener('click', () => $('#musicInput').click());
  $('#musicInput').addEventListener('change', () => {
    const f = $('#musicInput').files[0];
    if (!f) return;
    if (f.type.indexOf('audio/') !== 0) { showToast('File này không phải nhạc.'); return; }
    saveMusicBlob(f, f.name).catch((e) => showToast('Lỗi khi thêm nhạc: ' + e.message));
    $('#musicInput').value = '';
  });
  $('#musicVolume').addEventListener('input', () => {
    if (!current) return;
    const v = parseFloat($('#musicVolume').value);
    current.musicVolume = v;
    saveCurrentProject();
    setVolume(v);
  });
  $('#btnRemoveMusic').addEventListener('click', () => { removeMusic(); });

  /* --- Bước 4: xuất video --- */
  ['productName', 'productPrice', 'productPromo', 'productLink'].forEach((id) => {
    $('#' + id).addEventListener('input', () => {
      if (!current) return;
      current.product = {
        name: $('#productName').value.trim(),
        price: $('#productPrice').value.trim(),
        promo: $('#productPromo').value.trim(),
        link: $('#productLink').value.trim()
      };
      saveCurrentProject();
      drawPreviewFrame(preview.offset);
    });
  });
  $('#btnExport').addEventListener('click', exportVideo);
  $('#btnMakeCaption').addEventListener('click', () => {
    $('#captionText').value = buildCaption();
    showToast('Đã tạo caption. Bạn có thể sửa tay trước khi sao chép.');
  });
  $('#btnCopyCaption').addEventListener('click', async () => {
    const text = $('#captionText').value;
    if (!text.trim()) { showToast('Chưa có caption — bấm “Tạo caption” trước.'); return; }
    const ok = await copyText(text);
    showToast(ok ? 'Đã sao chép caption.' : 'Không sao chép được — hãy bôi đen rồi bấm Ctrl+C tay.');
  });
  $('#btnDownloadCaption').addEventListener('click', () => {
    const text = $('#captionText').value;
    if (!text.trim()) { showToast('Chưa có caption — bấm “Tạo caption” trước.'); return; }
    const name = (current && current.name ? current.name : 'caption').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-') + '.txt';
    downloadTextFile(name, text);
    showToast('Đã tải file caption .txt.');
  });

  /* --- Header: dự án & kết nối --- */
  $('#projectSelect').addEventListener('change', (e) => { switchProject(e.target.value); });
  $('#btnProjects').addEventListener('click', () => { renderProjectList(); openModal('projectsModal'); });
  $('#btnConnections').addEventListener('click', () => { fillConnectionInputs(); openModal('connectionsModal'); });
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; }));
  $('#btnNewProject').addEventListener('click', () => {
    const name = $('#newProjectName').value.trim() || 'Dự án mới';
    $('#newProjectName').value = '';
    createProject(name);
    renderProjectList();
  });
  $('#newProjectName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnNewProject').click();
  });
  $('#projectList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'open') { switchProject(id); closeModal('projectsModal'); }
    else if (act === 'rename') {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      const name = window.prompt('Tên mới cho dự án:', p.name);
      if (name && name.trim()) {
        p.name = name.trim();
        saveProjects();
        renderProjectList();
        renderProjectSelect();
      }
    }
    else if (act === 'dup') duplicateProject(id);
    else if (act === 'del') deleteProject(id);
  });

  /* --- Kết nối: lưu key khi gõ xong --- */
  const connFields = [
    ['aiBase', 'aiLab', 'baseUrl'], ['aiKey', 'aiLab', 'key'],
    ['sunoBase', 'suno', 'baseUrl'], ['sunoKey', 'suno', 'key'],
    ['orBase', 'openrouter', 'baseUrl'], ['orKey', 'openrouter', 'key'],
    ['pexelsKey', 'pexels', 'key']
  ];
  connFields.forEach(([inputId, svc, field]) => {
    $('#' + inputId).addEventListener('change', () => {
      connections[svc][field] = $('#' + inputId).value.trim();
      saveConnections();
      updateKeyStatuses();
    });
  });
  $('#btnCheckAi').addEventListener('click', checkAiLab);
  $('#btnCheckSuno').addEventListener('click', checkSuno);
  $('#btnCheckOr').addEventListener('click', checkOpenRouter);
  $('#btnCheckPexels').addEventListener('click', checkPexels);
}
