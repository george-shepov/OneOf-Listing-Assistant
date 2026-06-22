const DB_NAME = 'oneof-listing-assistant';
const DB_VERSION = 1;
const GROUP_STORE = 'groups';
const PHOTO_STORE = 'photos';
const SETTINGS_KEY = 'oneof-settings';

const state = {
  groups: [],
  photos: new Map(),
  settings: { groupWindowMinutes: 4, confirmCleanup: true },
  deferredInstallPrompt: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GROUP_STORE)) db.createObjectStore(GROUP_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(storeName, mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = operation(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function getAll(storeName) {
  return new Promise(async (resolve, reject) => {
    const db = await openDb();
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveGroup(group) {
  await transaction(GROUP_STORE, 'readwrite', (store) => store.put(group));
}

async function savePhoto(photo) {
  await transaction(PHOTO_STORE, 'readwrite', (store) => store.put(photo));
}

async function deleteRecord(storeName, id) {
  await transaction(storeName, 'readwrite', (store) => store.delete(id));
}

async function clearStore(storeName) {
  await transaction(storeName, 'readwrite', (store) => store.clear());
}

function photoUrl(photo) {
  if (!photo) return '';
  if (!photo.objectUrl) photo.objectUrl = URL.createObjectURL(photo.blob);
  return photo.objectUrl;
}

function statusLabel(status) {
  return ({ inbox: 'Inbox', product: 'Product', personal: 'Personal', draft: 'Draft ready', archived: 'Archived' })[status] ?? status;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function initialize() {
  const storedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
  if (storedSettings) state.settings = { ...state.settings, ...storedSettings };
  state.groups = (await getAll(GROUP_STORE)).sort((a, b) => b.createdAt - a.createdAt);
  const photos = await getAll(PHOTO_STORE);
  photos.forEach((photo) => state.photos.set(photo.id, photo));
  $('#groupWindow').value = state.settings.groupWindowMinutes;
  $('#confirmCleanup').checked = state.settings.confirmCleanup;
  render();
}

async function importFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;

  const imported = [];
  for (const file of files) {
    const photo = {
      id: uid('photo'),
      name: file.name || `Photo ${new Date().toLocaleString()}`,
      type: file.type || 'image/jpeg',
      size: file.size,
      capturedAt: file.lastModified || Date.now(),
      importedAt: Date.now(),
      blob: file,
    };
    await savePhoto(photo);
    state.photos.set(photo.id, photo);
    imported.push(photo);
  }

  const newGroups = buildGroups(imported);
  for (const group of newGroups) {
    await saveGroup(group);
    state.groups.unshift(group);
  }
  render();
  showToast(`${files.length} photo${files.length === 1 ? '' : 's'} imported`);
}

function buildGroups(photos) {
  const sorted = [...photos].sort((a, b) => a.capturedAt - b.capturedAt);
  const threshold = state.settings.groupWindowMinutes * 60_000;
  const batches = [];
  let batch = [];

  sorted.forEach((photo, index) => {
    const previous = sorted[index - 1];
    if (previous && photo.capturedAt - previous.capturedAt > threshold) {
      batches.push(batch);
      batch = [];
    }
    batch.push(photo);
  });
  if (batch.length) batches.push(batch);

  return batches.map((items, index) => ({
    id: uid('group'),
    title: inferTitle(items, index),
    status: items.length >= 2 ? 'product' : 'inbox',
    sku: '',
    platform: 'ebay',
    notes: items.length >= 2 ? 'Likely product batch based on adjacent capture times.' : 'Single image — classification needed.',
    safeToDelete: false,
    photoIds: items.map((item) => item.id),
    createdAt: Math.min(...items.map((item) => item.capturedAt)),
    updatedAt: Date.now(),
  }));
}

function inferTitle(items, index = 0) {
  const source = items[0]?.name?.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  if (source && !/^IMG\s*\d+$/i.test(source)) return source.slice(0, 80);
  return `Product batch ${state.groups.length + index + 1}`;
}

async function regroupInbox() {
  const candidates = state.groups.filter((group) => group.status === 'inbox' && !group.safeToDelete);
  const photos = candidates.flatMap((group) => group.photoIds.map((id) => state.photos.get(id)).filter(Boolean));
  if (photos.length < 2) {
    showToast('Not enough unclassified photos to regroup');
    return;
  }
  for (const group of candidates) await deleteRecord(GROUP_STORE, group.id);
  state.groups = state.groups.filter((group) => !candidates.includes(group));
  const rebuilt = buildGroups(photos);
  for (const group of rebuilt) {
    await saveGroup(group);
    state.groups.unshift(group);
  }
  render();
  showToast('Inbox regrouped by capture time');
}

function render() {
  renderStats();
  renderPhone();
  renderDesktop();
}

function renderStats() {
  $('#photoCount').textContent = state.photos.size;
  $('#groupCount').textContent = state.groups.length;
  $('#cleanupCount').textContent = state.groups.filter((group) => group.safeToDelete).reduce((sum, group) => sum + group.photoIds.length, 0);
  $('#draftCount').textContent = state.groups.filter((group) => group.status === 'draft').length;
}

function renderPhone() {
  const container = $('#phoneGroups');
  container.innerHTML = '';
  $('#phoneEmpty').classList.toggle('hidden', state.groups.length > 0);

  state.groups.forEach((group) => {
    const node = $('#phoneGroupTemplate').content.cloneNode(true);
    const card = node.querySelector('.phone-group-card');
    card.dataset.id = group.id;
    const strip = node.querySelector('.photo-strip');
    group.photoIds.slice(0, 8).forEach((id) => {
      const photo = state.photos.get(id);
      if (!photo) return;
      const image = new Image();
      image.src = photoUrl(photo);
      image.alt = photo.name;
      strip.append(image);
    });
    applyGroupText(node, group);
    node.querySelector('.edit-group').addEventListener('click', () => openGroupDialog(group.id));
    container.append(node);
  });
}

function filteredGroups() {
  const query = $('#searchInput')?.value.trim().toLowerCase() || '';
  const filter = $('#statusFilter')?.value || 'all';
  return state.groups.filter((group) => {
    const matchesStatus = filter === 'all' || group.status === filter;
    const haystack = `${group.title} ${group.sku} ${group.notes}`.toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
}

function renderDesktop() {
  const groups = filteredGroups();
  const container = $('#desktopGroups');
  container.innerHTML = '';
  $('#desktopEmpty').classList.toggle('hidden', groups.length > 0);

  groups.forEach((group) => {
    const node = $('#desktopGroupTemplate').content.cloneNode(true);
    const cover = node.querySelector('.desktop-cover');
    const firstPhoto = state.photos.get(group.photoIds[0]);
    if (firstPhoto) {
      const image = new Image();
      image.src = photoUrl(firstPhoto);
      image.alt = group.title;
      cover.append(image);
    }
    applyGroupText(node, group);
    node.querySelector('.platform-label').textContent = ({ ebay: 'eBay', facebook: 'Facebook', both: 'eBay + Facebook', none: 'No platform' })[group.platform];
    node.querySelector('.group-notes').textContent = group.notes || 'No notes yet.';
    node.querySelector('.edit-group').addEventListener('click', () => openGroupDialog(group.id));
    node.querySelector('.make-draft').addEventListener('click', () => createDraft(group.id));
    container.append(node);
  });
}

function applyGroupText(root, group) {
  const pill = root.querySelector('.status-pill');
  pill.textContent = statusLabel(group.status);
  pill.classList.add(`status-${group.status}`);
  root.querySelector('.group-title').textContent = group.title;
  root.querySelector('.group-meta').textContent = `${group.photoIds.length} photo${group.photoIds.length === 1 ? '' : 's'} · ${formatDate(group.createdAt)}${group.safeToDelete ? ' · cleanup approved' : ''}`;
}

function openGroupDialog(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  $('#editingGroupId').value = group.id;
  $('#dialogTitle').textContent = group.title;
  $('#groupTitle').value = group.title;
  $('#groupStatus').value = group.status;
  $('#groupSku').value = group.sku || '';
  $('#groupPlatform').value = group.platform || 'none';
  $('#groupNotes').value = group.notes || '';
  $('#safeToDelete').checked = Boolean(group.safeToDelete);
  const photos = $('#dialogPhotos');
  photos.innerHTML = '';
  group.photoIds.forEach((id) => {
    const photo = state.photos.get(id);
    if (!photo) return;
    const image = new Image();
    image.src = photoUrl(photo);
    image.alt = photo.name;
    photos.append(image);
  });
  $('#groupDialog').showModal();
}

async function saveDialogGroup(event) {
  event.preventDefault();
  const group = state.groups.find((item) => item.id === $('#editingGroupId').value);
  if (!group) return;
  const requestedCleanup = $('#safeToDelete').checked;
  if (requestedCleanup && !group.safeToDelete && state.settings.confirmCleanup) {
    const confirmed = confirm('Confirm that imported copies open correctly. This only marks the original photos as safe to delete; it does not delete anything from Apple Photos.');
    if (!confirmed) return;
  }
  Object.assign(group, {
    title: $('#groupTitle').value.trim(),
    status: $('#groupStatus').value,
    sku: $('#groupSku').value.trim(),
    platform: $('#groupPlatform').value,
    notes: $('#groupNotes').value.trim(),
    safeToDelete: requestedCleanup,
    updatedAt: Date.now(),
  });
  await saveGroup(group);
  $('#groupDialog').close();
  state.groups.sort((a, b) => b.createdAt - a.createdAt);
  render();
  showToast('Batch saved');
}

async function deleteCurrentGroup() {
  const groupId = $('#editingGroupId').value;
  const group = state.groups.find((item) => item.id === groupId);
  if (!group || !confirm('Delete this batch and its imported copies from the OneOf workspace? Apple Photos will not be affected.')) return;
  await deleteRecord(GROUP_STORE, group.id);
  for (const id of group.photoIds) {
    await deleteRecord(PHOTO_STORE, id);
    const photo = state.photos.get(id);
    if (photo?.objectUrl) URL.revokeObjectURL(photo.objectUrl);
    state.photos.delete(id);
  }
  state.groups = state.groups.filter((item) => item.id !== group.id);
  $('#groupDialog').close();
  render();
  showToast('Batch removed from local workspace');
}

async function createDraft(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  group.status = 'draft';
  if (!group.sku) group.sku = `ONEOF-${String(state.groups.indexOf(group) + 1).padStart(4, '0')}`;
  if (!group.notes.includes('Draft fields')) group.notes = `${group.notes}\nDraft fields still needed: condition, category, price, dimensions, shipping.`.trim();
  group.updatedAt = Date.now();
  await saveGroup(group);
  render();
  showToast('Listing draft checklist created');
}

async function createDemo() {
  if (state.groups.length && !confirm('Add demo batches to the existing workspace?')) return;
  const demoDefinitions = [
    { title: 'Sterling silver bracelet', colors: ['#d1d5db', '#9ca3af', '#e5e7eb'], notes: 'Marking: 925. Need weight, length, clasp close-up.', platform: 'both' },
    { title: 'Front CV axle pair', colors: ['#374151', '#111827', '#6b7280', '#9ca3af'], notes: 'Two units. Verify part number and whether loose nut belongs to the set.', platform: 'ebay' },
  ];
  for (const [groupIndex, definition] of demoDefinitions.entries()) {
    const photoIds = [];
    for (const [index, color] of definition.colors.entries()) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="48%" text-anchor="middle" font-family="Arial" font-size="54" fill="white">${definition.title}</text><text x="50%" y="56%" text-anchor="middle" font-family="Arial" font-size="30" fill="white">Photo ${index + 1}</text></svg>`;
      const photo = { id: uid('photo'), name: `demo-${groupIndex + 1}-${index + 1}.svg`, type: 'image/svg+xml', size: svg.length, capturedAt: Date.now() - (groupIndex * 600000) + index * 30000, importedAt: Date.now(), blob: new Blob([svg], { type: 'image/svg+xml' }) };
      await savePhoto(photo);
      state.photos.set(photo.id, photo);
      photoIds.push(photo.id);
    }
    const group = { id: uid('group'), title: definition.title, status: 'product', sku: '', platform: definition.platform, notes: definition.notes, safeToDelete: false, photoIds, createdAt: Date.now() - groupIndex * 600000, updatedAt: Date.now() };
    await saveGroup(group);
    state.groups.unshift(group);
  }
  render();
  showToast('Demo workspace loaded');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(',');
  const type = header.match(/data:(.*?);/)?.[1] || 'application/octet-stream';
  const bytes = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

async function exportWorkspace() {
  const photos = [];
  for (const photo of state.photos.values()) {
    photos.push({ ...photo, blob: undefined, objectUrl: undefined, dataUrl: await blobToDataUrl(photo.blob) });
  }
  const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), settings: state.settings, groups: state.groups, photos };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `oneof-workspace-${new Date().toISOString().slice(0, 10)}.oneof.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('Workspace export created');
}

async function importWorkspace(file) {
  const payload = JSON.parse(await file.text());
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.groups) || !Array.isArray(payload.photos)) throw new Error('Unsupported workspace file');
  if ((state.groups.length || state.photos.size) && !confirm('Replace the current local workspace with this file?')) return;
  await clearStore(GROUP_STORE);
  await clearStore(PHOTO_STORE);
  state.groups = [];
  state.photos.clear();
  state.settings = { ...state.settings, ...payload.settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  for (const item of payload.photos) {
    const { dataUrl, ...metadata } = item;
    const photo = { ...metadata, blob: dataUrlToBlob(dataUrl) };
    await savePhoto(photo);
    state.photos.set(photo.id, photo);
  }
  for (const group of payload.groups) {
    await saveGroup(group);
    state.groups.push(group);
  }
  state.groups.sort((a, b) => b.createdAt - a.createdAt);
  $('#groupWindow').value = state.settings.groupWindowMinutes;
  $('#confirmCleanup').checked = state.settings.confirmCleanup;
  render();
  showToast('Workspace imported');
}

async function resetWorkspace() {
  if (!confirm('Reset this browser workspace? Imported copies and metadata will be deleted. Apple Photos will not be affected.')) return;
  await clearStore(GROUP_STORE);
  await clearStore(PHOTO_STORE);
  state.groups = [];
  state.photos.forEach((photo) => photo.objectUrl && URL.revokeObjectURL(photo.objectUrl));
  state.photos.clear();
  render();
  showToast('Local workspace reset');
}

function selectView(viewName) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === viewName));
  $$('.view').forEach((view) => view.classList.remove('active'));
  $(`#${viewName}View`).classList.add('active');
  location.hash = viewName;
}

function wireEvents() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => selectView(tab.dataset.view)));
  $('#photoPicker').addEventListener('change', (event) => importFiles(event.target.files).finally(() => { event.target.value = ''; }));
  $('#cameraPicker').addEventListener('change', (event) => importFiles(event.target.files).finally(() => { event.target.value = ''; }));
  $('#autoGroupButton').addEventListener('click', regroupInbox);
  $('#demoButton').addEventListener('click', createDemo);
  $('#groupForm').addEventListener('submit', saveDialogGroup);
  $('#deleteGroupButton').addEventListener('click', deleteCurrentGroup);
  $('#searchInput').addEventListener('input', renderDesktop);
  $('#statusFilter').addEventListener('change', renderDesktop);
  $('#exportButton').addEventListener('click', exportWorkspace);
  $('#importPicker').addEventListener('change', async (event) => {
    try { if (event.target.files[0]) await importWorkspace(event.target.files[0]); }
    catch (error) { showToast(error.message); }
    finally { event.target.value = ''; }
  });
  $('#groupWindow').addEventListener('change', (event) => {
    state.settings.groupWindowMinutes = Math.max(1, Math.min(30, Number(event.target.value) || 4));
    event.target.value = state.settings.groupWindowMinutes;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  });
  $('#confirmCleanup').addEventListener('change', (event) => {
    state.settings.confirmCleanup = event.target.checked;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  });
  $('#resetButton').addEventListener('click', resetWorkspace);
  $('#installButton').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    $('#installButton').classList.add('hidden');
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    $('#installButton').classList.remove('hidden');
  });
}

wireEvents();
initialize().catch((error) => {
  console.error(error);
  showToast('Could not open the local photo database');
});

const initialView = ['phone', 'desktop', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : (matchMedia('(max-width: 760px)').matches ? 'phone' : 'desktop');
selectView(initialView);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
