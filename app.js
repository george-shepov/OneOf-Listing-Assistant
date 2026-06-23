const DB_NAME = 'oneof-listing-assistant';
const DB_VERSION = 2;
const GROUP_STORE = 'groups';
const PHOTO_STORE = 'photos';
const SETTINGS_KEY = 'oneof-settings-v2';

const DEFAULT_SETTINGS = {
  groupWindowMinutes: 4,
  confirmCleanup: true,
  apiBaseUrl: '',
  marketplaceId: 'EBAY_US',
  merchantLocationKey: '',
  fulfillmentPolicyId: '',
  paymentPolicyId: '',
  returnPolicyId: '',
};

const state = {
  groups: [],
  photos: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  deferredInstallPrompt: null,
  apiStatus: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const numberValue = (selector, fallback = 0) => Number($(selector)?.value) || fallback;
const textValue = (selector) => $(selector)?.value?.trim() || '';

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
    operation(store);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
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

const saveGroup = (group) => transaction(GROUP_STORE, 'readwrite', (store) => store.put(group));
const savePhoto = (photo) => transaction(PHOTO_STORE, 'readwrite', (store) => store.put(photo));
const deleteRecord = (storeName, id) => transaction(storeName, 'readwrite', (store) => store.delete(id));
const clearStore = (storeName) => transaction(storeName, 'readwrite', (store) => store.clear());

function listingDefaults() {
  return {
    title: '',
    description: '',
    categoryId: '',
    condition: '',
    conditionDescription: '',
    brand: '',
    upc: '',
    quantity: 1,
    price: 0,
    minPrice: 0,
    currency: 'USD',
    aspects: {},
    package: { length: 0, width: 0, height: 0, weight: 0 },
    merchantLocationKey: '',
    fulfillmentPolicyId: '',
    paymentPolicyId: '',
    returnPolicyId: '',
    ebay: {
      status: 'not_ready',
      offerId: '',
      listingId: '',
      listingUrl: '',
      lastPublishedAt: '',
      lastError: '',
    },
  };
}

function metricsDefaults() {
  return { impressions: 0, views: 0, watchers: 0, sales: 0, ageDays: 0, returns: 0, lastCheckedAt: '' };
}

function optimizerDefaults() {
  return { health: 'unknown', action: '', title: 'Not analyzed', reason: 'Add metrics and run analysis.', score: 0, experiments: [], analyzedAt: '' };
}

function normalizeGroup(raw) {
  const listing = { ...listingDefaults(), ...(raw.listing || {}) };
  listing.package = { ...listingDefaults().package, ...(raw.listing?.package || {}) };
  listing.ebay = { ...listingDefaults().ebay, ...(raw.listing?.ebay || {}) };
  listing.title ||= raw.title || '';
  return {
    id: raw.id || uid('group'),
    title: raw.title || listing.title || 'Untitled product',
    status: raw.status || 'inbox',
    sku: raw.sku || '',
    platform: raw.platform || 'ebay',
    notes: raw.notes || '',
    safeToDelete: Boolean(raw.safeToDelete),
    photoIds: Array.isArray(raw.photoIds) ? raw.photoIds : [],
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
    listing,
    metrics: { ...metricsDefaults(), ...(raw.metrics || {}) },
    optimizer: { ...optimizerDefaults(), ...(raw.optimizer || {}) },
  };
}

function photoUrl(photo) {
  if (!photo) return '';
  if (!photo.objectUrl) photo.objectUrl = URL.createObjectURL(photo.blob);
  return photo.objectUrl;
}

function statusLabel(status) {
  return ({ inbox: 'Inbox', product: 'Product', personal: 'Personal', draft: 'Draft ready', published: 'Published', archived: 'Archived' })[status] ?? status;
}

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
}

function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0);
}

function showToast(message, duration = 2800) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

async function initialize() {
  const oldSettings = JSON.parse(localStorage.getItem('oneof-settings') || 'null');
  const storedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
  state.settings = { ...DEFAULT_SETTINGS, ...(oldSettings || {}), ...(storedSettings || {}) };
  state.groups = (await getAll(GROUP_STORE)).map(normalizeGroup).sort((a, b) => b.createdAt - a.createdAt);
  const photos = await getAll(PHOTO_STORE);
  photos.forEach((photo) => state.photos.set(photo.id, photo));
  populateSettingsForm();
  render();
}

function populateSettingsForm() {
  $('#groupWindow').value = state.settings.groupWindowMinutes;
  $('#confirmCleanup').checked = state.settings.confirmCleanup;
  $('#apiBaseUrl').value = state.settings.apiBaseUrl || '';
  $('#defaultMarketplace').value = state.settings.marketplaceId || 'EBAY_US';
  $('#defaultLocationKey').value = state.settings.merchantLocationKey || '';
  $('#defaultFulfillmentPolicyId').value = state.settings.fulfillmentPolicyId || '';
  $('#defaultPaymentPolicyId').value = state.settings.paymentPolicyId || '';
  $('#defaultReturnPolicyId').value = state.settings.returnPolicyId || '';
}

async function importFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;
  const imported = [];
  for (const file of files) {
    const photo = {
      id: uid('photo'), name: file.name || `Photo ${new Date().toLocaleString()}`,
      type: file.type || 'image/jpeg', size: file.size,
      capturedAt: file.lastModified || Date.now(), importedAt: Date.now(), blob: file,
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

  return batches.map((items, index) => normalizeGroup({
    id: uid('group'),
    title: inferTitle(items, index),
    status: items.length >= 2 ? 'product' : 'inbox',
    platform: 'ebay',
    notes: items.length >= 2 ? 'Likely product batch based on adjacent capture times.' : 'Single image — classification needed.',
    photoIds: items.map((item) => item.id),
    createdAt: Math.min(...items.map((item) => item.capturedAt)),
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
  if (photos.length < 2) return showToast('Not enough unclassified photos to regroup');
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
  renderPublisher();
  renderOptimizer();
  renderApiBadge();
}

function renderStats() {
  $('#photoCount').textContent = state.photos.size;
  $('#groupCount').textContent = state.groups.length;
  $('#draftCount').textContent = state.groups.filter((group) => group.status === 'draft').length;
  $('#publishedCount').textContent = state.groups.filter((group) => group.status === 'published' || group.listing.ebay.status === 'published').length;
}

function renderPhone() {
  const container = $('#phoneGroups');
  container.innerHTML = '';
  $('#phoneEmpty').classList.toggle('hidden', state.groups.length > 0);
  state.groups.forEach((group) => {
    const node = $('#phoneGroupTemplate').content.cloneNode(true);
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
    const haystack = `${group.title} ${group.sku} ${group.notes} ${group.listing.brand} ${group.listing.categoryId}`.toLowerCase();
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
    setCoverImage(node.querySelector('.desktop-cover'), group);
    applyGroupText(node, group);
    node.querySelector('.platform-label').textContent = ({ ebay: 'eBay', facebook: 'Facebook', both: 'eBay + Facebook', none: 'No platform' })[group.platform] || group.platform;
    node.querySelector('.group-notes').textContent = group.notes || 'No notes yet.';
    node.querySelector('.listing-mini-facts').innerHTML = [
      group.listing.categoryId ? `Category ${escapeHtml(group.listing.categoryId)}` : 'Category missing',
      group.listing.price ? formatMoney(group.listing.price) : 'Price missing',
      `${group.photoIds.length} photo${group.photoIds.length === 1 ? '' : 's'}`,
    ].map((item) => `<span>${item}</span>`).join('');
    node.querySelector('.edit-group').addEventListener('click', () => openGroupDialog(group.id));
    node.querySelector('.make-draft').addEventListener('click', () => createDraft(group.id));
    container.append(node);
  });
}

function setCoverImage(container, group) {
  const photo = state.photos.get(group.photoIds[0]);
  if (!photo) return;
  const image = new Image();
  image.src = photoUrl(photo);
  image.alt = group.title;
  container.append(image);
}

function applyGroupText(root, group) {
  const pill = root.querySelector('.status-pill');
  pill.textContent = statusLabel(group.status);
  pill.className = `status-pill status-${group.status}`;
  root.querySelector('.group-title').textContent = group.title;
  root.querySelector('.group-meta').textContent = `${group.sku || 'No SKU'} · ${formatDate(group.createdAt)}${group.safeToDelete ? ' · cleanup approved' : ''}`;
}

function readiness(group) {
  const listing = group.listing;
  const checks = [
    ['SKU', Boolean(group.sku)],
    ['Title', Boolean(group.title && group.title.length <= 80)],
    ['Category', Boolean(listing.categoryId)],
    ['Condition', Boolean(listing.condition)],
    ['Description', Boolean(listing.description)],
    ['Price', Number(listing.price) > 0],
    ['Photo', group.photoIds.length > 0],
    ['Location', Boolean(listing.merchantLocationKey || state.settings.merchantLocationKey)],
    ['Fulfillment policy', Boolean(listing.fulfillmentPolicyId || state.settings.fulfillmentPolicyId)],
    ['Payment policy', Boolean(listing.paymentPolicyId || state.settings.paymentPolicyId)],
    ['Return policy', Boolean(listing.returnPolicyId || state.settings.returnPolicyId)],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return { ready: missing.length === 0, missing, checks };
}

function renderPublisher() {
  const groups = state.groups.filter((group) => ['draft', 'published'].includes(group.status) || group.listing.ebay.status === 'published');
  const container = $('#publisherGroups');
  container.innerHTML = '';
  $('#publisherEmpty').classList.toggle('hidden', groups.length > 0);
  const readyTotal = groups.filter((group) => readiness(group).ready && group.listing.ebay.status !== 'published').length;
  $('#readyCountBadge').textContent = `${readyTotal} ready`;

  groups.forEach((group) => {
    const node = $('#publisherGroupTemplate').content.cloneNode(true);
    setCoverImage(node.querySelector('.publisher-thumb'), group);
    applyGroupText(node, group);
    const result = readiness(group);
    const readinessPill = node.querySelector('.readiness-pill');
    readinessPill.textContent = group.listing.ebay.status === 'published' ? 'Live' : result.ready ? 'Ready' : `${result.missing.length} missing`;
    readinessPill.className = `readiness-pill ${group.listing.ebay.status === 'published' ? 'ready' : result.ready ? 'ready' : 'not-ready'}`;
    node.querySelector('.readiness-list').innerHTML = result.checks.map(([label, ok]) => `<span class="${ok ? 'check-ok' : 'check-missing'}">${ok ? '✓' : '•'} ${escapeHtml(label)}</span>`).join('');
    const publishResult = node.querySelector('.publish-result');
    if (group.listing.ebay.status === 'published') {
      publishResult.classList.remove('hidden');
      publishResult.innerHTML = `<strong>Published</strong> ${group.listing.ebay.listingId ? `· Listing ${escapeHtml(group.listing.ebay.listingId)}` : ''}${group.listing.ebay.listingUrl ? ` · <a href="${escapeAttribute(group.listing.ebay.listingUrl)}" target="_blank" rel="noopener">Open on eBay</a>` : ''}`;
    } else if (group.listing.ebay.lastError) {
      publishResult.classList.remove('hidden');
      publishResult.classList.add('error-result');
      publishResult.textContent = group.listing.ebay.lastError;
    }
    node.querySelector('.preview-payload').addEventListener('click', () => previewPayload(group.id));
    node.querySelector('.edit-group').addEventListener('click', () => openGroupDialog(group.id));
    const publishButton = node.querySelector('.publish-group');
    publishButton.disabled = !result.ready || group.listing.ebay.status === 'published';
    publishButton.textContent = group.listing.ebay.status === 'published' ? 'Published' : 'Publish';
    publishButton.addEventListener('click', () => publishGroup(group.id, publishButton));
    container.append(node);
  });
}

function analyzeListing(group) {
  const m = group.metrics;
  const r = readiness(group);
  const ctr = m.impressions > 0 ? m.views / m.impressions : 0;
  const conversion = m.views > 0 ? m.sales / m.views : 0;
  let result;

  if (!group.listing.categoryId || Object.keys(group.listing.aspects || {}).length < 2) {
    result = { health: 'discovery', score: 25, action: 'category_specifics', title: 'Correct category and item specifics', reason: 'Search visibility is limited when the category or required product attributes are incomplete.' };
  } else if (m.ageDays >= 7 && m.impressions < 25) {
    result = { health: 'discovery', score: 35, action: 'title', title: 'Rewrite the title for search intent', reason: `Only ${m.impressions} impressions after ${m.ageDays} days. Verify high-value keywords, brand, model, size, and item type.` };
  } else if (m.impressions >= 100 && ctr < 0.01) {
    result = { health: 'conversion', score: 45, action: 'primary_photo', title: 'Replace the primary photo first', reason: `${(ctr * 100).toFixed(1)}% click-through from ${m.impressions} impressions suggests the hero image or title is not earning clicks.` };
  } else if (m.views >= 10 && m.sales === 0 && m.watchers === 0) {
    result = { health: 'conversion', score: 55, action: 'description_shipping', title: 'Strengthen condition, description, and shipping', reason: `${m.views} shoppers opened the listing without watching or buying. Remove uncertainty before changing price.` };
  } else if (m.watchers >= 2 && m.sales === 0) {
    result = { health: 'conversion', score: 65, action: 'offer_shipping', title: 'Send an offer or improve shipping', reason: `${m.watchers} watchers indicate demand. Test an offer or shipping adjustment before reducing the public price.` };
  } else if (m.ageDays >= 60 && m.sales === 0 && m.views >= 5) {
    result = { health: 'price', score: 40, action: 'price', title: 'Review price against the configured floor', reason: `The listing is ${m.ageDays} days old with traffic but no sale. Price is now the last unresolved lever.` };
  } else if (!r.ready) {
    result = { health: 'discovery', score: 30, action: 'completeness', title: 'Complete the listing data', reason: `Missing: ${r.missing.join(', ')}.` };
  } else {
    result = { health: 'healthy', score: Math.min(100, 75 + Math.round(conversion * 100)), action: 'monitor', title: 'Monitor without changing the listing', reason: 'The current funnel does not show a strong failure signal. Avoid unnecessary revisions.' };
  }
  group.optimizer = { ...group.optimizer, ...result, analyzedAt: new Date().toISOString() };
  return result;
}

function renderOptimizer() {
  const groups = state.groups.filter((group) => ['draft', 'published'].includes(group.status) || Object.values(group.metrics).some((value) => Number(value) > 0));
  const container = $('#optimizerGroups');
  container.innerHTML = '';
  $('#optimizerEmpty').classList.toggle('hidden', groups.length > 0);
  const counts = { healthy: 0, discovery: 0, conversion: 0, price: 0, unknown: 0 };
  groups.forEach((group) => { counts[group.optimizer.health || 'unknown'] = (counts[group.optimizer.health || 'unknown'] || 0) + 1; });
  $('#optimizerHealthy').textContent = counts.healthy;
  $('#optimizerDiscovery').textContent = counts.discovery;
  $('#optimizerConversion').textContent = counts.conversion;
  $('#optimizerPrice').textContent = counts.price;

  groups.forEach((group) => {
    const node = $('#optimizerGroupTemplate').content.cloneNode(true);
    const health = group.optimizer.health || 'unknown';
    const healthPill = node.querySelector('.health-pill');
    healthPill.textContent = health === 'unknown' ? 'Not analyzed' : health;
    healthPill.className = `health-pill health-${health}`;
    node.querySelector('.group-title').textContent = group.title;
    node.querySelector('.group-meta').textContent = `${group.sku || 'No SKU'} · ${group.metrics.ageDays || 0} days active`;
    node.querySelector('.metric-summary').innerHTML = `<strong>${group.metrics.impressions || 0}</strong> impressions · <strong>${group.metrics.views || 0}</strong> views · <strong>${group.metrics.watchers || 0}</strong> watchers · <strong>${group.metrics.sales || 0}</strong> sales`;
    const max = Math.max(group.metrics.impressions || 0, 1);
    node.querySelector('.impressions-bar').style.width = '100%';
    node.querySelector('.views-bar').style.width = `${Math.max(2, Math.min(100, ((group.metrics.views || 0) / max) * 100))}%`;
    node.querySelector('.sales-bar').style.width = `${Math.max(0, Math.min(100, ((group.metrics.sales || 0) / max) * 100))}%`;
    node.querySelector('.recommendation-title').textContent = group.optimizer.title || 'Not analyzed';
    node.querySelector('.recommendation-reason').textContent = group.optimizer.reason || 'Add metrics and run analysis.';
    node.querySelector('.edit-group').addEventListener('click', () => openGroupDialog(group.id));
    node.querySelector('.analyze-group').addEventListener('click', () => analyzeAndSave(group.id));
    node.querySelector('.log-experiment').addEventListener('click', () => logExperiment(group.id));
    container.append(node);
  });
}

function parseAspects(text) {
  const aspects = {};
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const separator = line.indexOf(':');
    if (separator < 1) return;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name && value) aspects[name] = value.split(',').map((item) => item.trim()).filter(Boolean);
  });
  return aspects;
}

function formatAspects(aspects = {}) {
  return Object.entries(aspects).map(([name, values]) => `${name}: ${(Array.isArray(values) ? values : [values]).join(', ')}`).join('\n');
}

function openGroupDialog(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  const listing = group.listing;
  const metrics = group.metrics;
  $('#editingGroupId').value = group.id;
  $('#dialogTitle').textContent = group.title;
  $('#groupTitle').value = group.title;
  $('#groupStatus').value = group.status;
  $('#groupSku').value = group.sku || '';
  $('#groupPlatform').value = group.platform || 'none';
  $('#groupNotes').value = group.notes || '';
  $('#safeToDelete').checked = Boolean(group.safeToDelete);
  $('#listingBrand').value = listing.brand || '';
  $('#listingCategoryId').value = listing.categoryId || '';
  $('#listingCondition').value = listing.condition || '';
  $('#listingUpc').value = listing.upc || '';
  $('#listingQuantity').value = listing.quantity || 1;
  $('#listingPrice').value = listing.price || '';
  $('#listingMinPrice').value = listing.minPrice || '';
  $('#listingConditionDescription').value = listing.conditionDescription || '';
  $('#listingDescription').value = listing.description || '';
  $('#listingAspects').value = formatAspects(listing.aspects);
  $('#packageLength').value = listing.package.length || '';
  $('#packageWidth').value = listing.package.width || '';
  $('#packageHeight').value = listing.package.height || '';
  $('#packageWeight').value = listing.package.weight || '';
  $('#listingLocationKey').value = listing.merchantLocationKey || state.settings.merchantLocationKey || '';
  $('#listingFulfillmentPolicyId').value = listing.fulfillmentPolicyId || state.settings.fulfillmentPolicyId || '';
  $('#listingPaymentPolicyId').value = listing.paymentPolicyId || state.settings.paymentPolicyId || '';
  $('#listingReturnPolicyId').value = listing.returnPolicyId || state.settings.returnPolicyId || '';
  $('#metricImpressions').value = metrics.impressions || 0;
  $('#metricViews').value = metrics.views || 0;
  $('#metricWatchers').value = metrics.watchers || 0;
  $('#metricSales').value = metrics.sales || 0;
  $('#metricAgeDays').value = metrics.ageDays || 0;
  $('#metricReturns').value = metrics.returns || 0;
  updateTitleLength();

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

function readGroupForm(group) {
  const title = textValue('#groupTitle').slice(0, 80);
  group.title = title;
  group.status = $('#groupStatus').value;
  group.sku = textValue('#groupSku');
  group.platform = $('#groupPlatform').value;
  group.notes = textValue('#groupNotes');
  group.safeToDelete = $('#safeToDelete').checked;
  group.updatedAt = Date.now();
  group.listing = {
    ...group.listing,
    title,
    brand: textValue('#listingBrand'),
    categoryId: textValue('#listingCategoryId'),
    condition: $('#listingCondition').value,
    upc: textValue('#listingUpc'),
    quantity: Math.max(1, numberValue('#listingQuantity', 1)),
    price: numberValue('#listingPrice'),
    minPrice: numberValue('#listingMinPrice'),
    conditionDescription: textValue('#listingConditionDescription'),
    description: textValue('#listingDescription'),
    aspects: parseAspects($('#listingAspects').value),
    package: {
      length: numberValue('#packageLength'), width: numberValue('#packageWidth'),
      height: numberValue('#packageHeight'), weight: numberValue('#packageWeight'),
    },
    merchantLocationKey: textValue('#listingLocationKey'),
    fulfillmentPolicyId: textValue('#listingFulfillmentPolicyId'),
    paymentPolicyId: textValue('#listingPaymentPolicyId'),
    returnPolicyId: textValue('#listingReturnPolicyId'),
  };
  group.metrics = {
    ...group.metrics,
    impressions: numberValue('#metricImpressions'), views: numberValue('#metricViews'),
    watchers: numberValue('#metricWatchers'), sales: numberValue('#metricSales'),
    ageDays: numberValue('#metricAgeDays'), returns: numberValue('#metricReturns'),
    lastCheckedAt: new Date().toISOString(),
  };
}

async function saveDialogGroup(event) {
  event.preventDefault();
  const group = state.groups.find((item) => item.id === $('#editingGroupId').value);
  if (!group) return;
  const requestedCleanup = $('#safeToDelete').checked;
  if (requestedCleanup && !group.safeToDelete && state.settings.confirmCleanup) {
    const confirmed = confirm('Confirm that imported copies open correctly. This only marks originals as safe to delete; it does not delete anything from Apple Photos.');
    if (!confirmed) return;
  }
  readGroupForm(group);
  await saveGroup(group);
  $('#groupDialog').close();
  render();
  showToast('Product saved');
}

async function deleteCurrentGroup() {
  const group = state.groups.find((item) => item.id === $('#editingGroupId').value);
  if (!group || !confirm('Delete this product and its imported copies from OneOf? Apple Photos and eBay will not be affected.')) return;
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
  showToast('Product removed from local workspace');
}

async function createDraft(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  group.status = 'draft';
  if (!group.sku) group.sku = `ONEOF-${String(state.groups.indexOf(group) + 1).padStart(4, '0')}`;
  group.listing.title ||= group.title;
  group.listing.merchantLocationKey ||= state.settings.merchantLocationKey;
  group.listing.fulfillmentPolicyId ||= state.settings.fulfillmentPolicyId;
  group.listing.paymentPolicyId ||= state.settings.paymentPolicyId;
  group.listing.returnPolicyId ||= state.settings.returnPolicyId;
  group.updatedAt = Date.now();
  await saveGroup(group);
  render();
  showToast('Listing draft created');
}

function buildPublishMetadata(group) {
  return {
    sku: group.sku,
    marketplaceId: state.settings.marketplaceId || 'EBAY_US',
    title: group.title,
    description: group.listing.description,
    categoryId: group.listing.categoryId,
    condition: group.listing.condition,
    conditionDescription: group.listing.conditionDescription,
    brand: group.listing.brand,
    upc: group.listing.upc,
    quantity: group.listing.quantity || 1,
    price: group.listing.price,
    minPrice: group.listing.minPrice,
    currency: group.listing.currency || 'USD',
    aspects: group.listing.aspects || {},
    package: group.listing.package,
    merchantLocationKey: group.listing.merchantLocationKey || state.settings.merchantLocationKey,
    fulfillmentPolicyId: group.listing.fulfillmentPolicyId || state.settings.fulfillmentPolicyId,
    paymentPolicyId: group.listing.paymentPolicyId || state.settings.paymentPolicyId,
    returnPolicyId: group.listing.returnPolicyId || state.settings.returnPolicyId,
  };
}

function previewPayload(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  $('#payloadPreview').textContent = JSON.stringify(buildPublishMetadata(group), null, 2);
  $('#payloadDialog').showModal();
}

function previewCurrentForm() {
  const group = state.groups.find((item) => item.id === $('#editingGroupId').value);
  if (!group) return;
  const copy = normalizeGroup(JSON.parse(JSON.stringify(group)));
  readGroupForm(copy);
  $('#payloadPreview').textContent = JSON.stringify(buildPublishMetadata(copy), null, 2);
  $('#payloadDialog').showModal();
}

async function publishGroup(groupId, button) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  const result = readiness(group);
  if (!result.ready) return showToast(`Missing: ${result.missing.join(', ')}`, 5000);
  if (!state.settings.apiBaseUrl) return showToast('Set the secure API base URL in Settings');
  if (!confirm(`Publish “${group.title}” to eBay?`)) return;
  const originalText = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Publishing…'; }
  try {
    const form = new FormData();
    form.append('metadata', JSON.stringify(buildPublishMetadata(group)));
    group.photoIds.forEach((id, index) => {
      const photo = state.photos.get(id);
      if (photo?.blob) form.append('images', photo.blob, photo.name || `image-${index + 1}.jpg`);
    });
    const response = await fetch(`${normalizeApiUrl(state.settings.apiBaseUrl)}/api/ebay/listings/publish`, { method: 'POST', body: form });
    const payload = await parseResponse(response);
    if (!response.ok) throw new Error(payload.detail || payload.message || JSON.stringify(payload));
    group.status = 'published';
    group.listing.ebay = {
      ...group.listing.ebay,
      status: 'published', offerId: payload.offerId || '', listingId: payload.listingId || '',
      listingUrl: payload.listingUrl || '', lastPublishedAt: new Date().toISOString(), lastError: '',
    };
    await saveGroup(group);
    render();
    showToast(`Published${payload.listingId ? ` as ${payload.listingId}` : ''}`);
  } catch (error) {
    console.error(error);
    group.listing.ebay = { ...group.listing.ebay, status: 'error', lastError: error.message };
    await saveGroup(group);
    render();
    showToast(`Publish failed: ${error.message}`, 7000);
  } finally {
    if (button) { button.disabled = false; button.textContent = originalText; }
  }
}

async function publishAllReady() {
  const readyGroups = state.groups.filter((group) => group.status === 'draft' && readiness(group).ready && group.listing.ebay.status !== 'published');
  if (!readyGroups.length) return showToast('No unpublished listings are ready');
  if (!confirm(`Publish ${readyGroups.length} ready listing${readyGroups.length === 1 ? '' : 's'} sequentially?`)) return;
  for (const group of readyGroups) await publishGroup(group.id);
}

async function checkApiStatus() {
  if (!state.settings.apiBaseUrl) {
    state.apiStatus = { ok: false, message: 'API URL not configured' };
    renderApiBadge();
    return showToast('Set the API base URL in Settings');
  }
  try {
    const response = await fetch(`${normalizeApiUrl(state.settings.apiBaseUrl)}/api/ebay/status`, { headers: { Accept: 'application/json' } });
    const payload = await parseResponse(response);
    if (!response.ok) throw new Error(payload.detail || payload.message || 'API unavailable');
    state.apiStatus = { ok: Boolean(payload.configured), message: payload.configured ? `${payload.environment || 'eBay'} configured` : 'API online; eBay not configured', payload };
    showToast(state.apiStatus.message);
  } catch (error) {
    state.apiStatus = { ok: false, message: error.message };
    showToast(`API check failed: ${error.message}`);
  }
  renderApiBadge();
}

function renderApiBadge() {
  const badge = $('#apiBadge');
  if (!state.settings.apiBaseUrl) {
    badge.textContent = 'eBay API not configured';
    badge.className = 'badge badge-muted';
  } else if (!state.apiStatus) {
    badge.textContent = 'eBay API configured';
    badge.className = 'badge badge-warning';
  } else {
    badge.textContent = state.apiStatus.message;
    badge.className = `badge ${state.apiStatus.ok ? 'badge-success' : 'badge-danger'}`;
  }
}

async function analyzeAndSave(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  analyzeListing(group);
  await saveGroup(group);
  renderOptimizer();
  showToast(group.optimizer.title);
}

async function analyzeAll() {
  const groups = state.groups.filter((group) => ['draft', 'published'].includes(group.status) || Object.values(group.metrics).some((value) => Number(value) > 0));
  for (const group of groups) {
    analyzeListing(group);
    await saveGroup(group);
  }
  renderOptimizer();
  showToast(`${groups.length} listing${groups.length === 1 ? '' : 's'} analyzed`);
}

async function logExperiment(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  if (!group.optimizer.action || group.optimizer.action === 'monitor') return showToast('Run analysis before logging an experiment');
  const note = prompt('Describe the single change you will test:', group.optimizer.title);
  if (!note) return;
  group.optimizer.experiments = [...(group.optimizer.experiments || []), {
    id: uid('experiment'), createdAt: new Date().toISOString(), action: group.optimizer.action,
    note, baseline: { ...group.metrics }, reviewAfterDays: 7, status: 'running',
  }];
  await saveGroup(group);
  showToast('Experiment logged; review after 7 days');
}

async function createDemo() {
  if (state.groups.length && !confirm('Add demo products to the existing workspace?')) return;
  const definitions = [
    {
      title: 'Sterling Silver Bracelet 925 Textured Link 48.24g', colors: ['#d1d5db', '#9ca3af', '#e5e7eb'], notes: 'Verify length and clasp.',
      listing: { categoryId: '261987', condition: 'USED_GOOD', brand: 'Unbranded', price: 59.99, minPrice: 44, description: 'Pre-owned sterling silver bracelet. Please review photos for condition.', aspects: { Metal: ['Sterling Silver'], Type: ['Bracelet'] } },
      metrics: { impressions: 840, views: 5, watchers: 0, sales: 0, ageDays: 14, returns: 0 },
    },
    {
      title: 'Pair Front CV Axle Assemblies Replacement Parts', colors: ['#374151', '#111827', '#6b7280', '#9ca3af'], notes: 'Two units. Verify part number and loose nut.',
      listing: { categoryId: '', condition: 'NEW_OTHER', brand: 'Unbranded', price: 79.99, minPrice: 60, description: 'Pair of replacement CV axle assemblies. Compatibility is unverified.', aspects: {} },
      metrics: { impressions: 12, views: 1, watchers: 0, sales: 0, ageDays: 21, returns: 0 },
    },
  ];
  for (const [groupIndex, definition] of definitions.entries()) {
    const photoIds = [];
    for (const [index, color] of definition.colors.entries()) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="48%" text-anchor="middle" font-family="Arial" font-size="42" fill="white">${escapeHtml(definition.title)}</text><text x="50%" y="56%" text-anchor="middle" font-family="Arial" font-size="30" fill="white">Photo ${index + 1}</text></svg>`;
      const photo = { id: uid('photo'), name: `demo-${groupIndex + 1}-${index + 1}.svg`, type: 'image/svg+xml', size: svg.length, capturedAt: Date.now() - (groupIndex * 600000) + index * 30000, importedAt: Date.now(), blob: new Blob([svg], { type: 'image/svg+xml' }) };
      await savePhoto(photo);
      state.photos.set(photo.id, photo);
      photoIds.push(photo.id);
    }
    const group = normalizeGroup({
      id: uid('group'), title: definition.title, status: 'draft', sku: `ONEOF-DEMO-${groupIndex + 1}`, platform: 'ebay', notes: definition.notes,
      photoIds, createdAt: Date.now() - groupIndex * 600000,
      listing: { ...listingDefaults(), ...definition.listing, merchantLocationKey: state.settings.merchantLocationKey, fulfillmentPolicyId: state.settings.fulfillmentPolicyId, paymentPolicyId: state.settings.paymentPolicyId, returnPolicyId: state.settings.returnPolicyId },
      metrics: definition.metrics,
    });
    analyzeListing(group);
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
  for (const photo of state.photos.values()) photos.push({ ...photo, blob: undefined, objectUrl: undefined, dataUrl: await blobToDataUrl(photo.blob) });
  const payload = { schemaVersion: 2, exportedAt: new Date().toISOString(), settings: state.settings, groups: state.groups, photos };
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
  if (![1, 2].includes(payload.schemaVersion) || !Array.isArray(payload.groups) || !Array.isArray(payload.photos)) throw new Error('Unsupported workspace file');
  if ((state.groups.length || state.photos.size) && !confirm('Replace the current local workspace with this file?')) return;
  await clearStore(GROUP_STORE);
  await clearStore(PHOTO_STORE);
  state.groups = [];
  state.photos.clear();
  state.settings = { ...DEFAULT_SETTINGS, ...payload.settings };
  persistSettings();
  for (const item of payload.photos) {
    const { dataUrl, ...metadata } = item;
    const photo = { ...metadata, blob: dataUrlToBlob(dataUrl) };
    await savePhoto(photo);
    state.photos.set(photo.id, photo);
  }
  for (const raw of payload.groups) {
    const group = normalizeGroup(raw);
    await saveGroup(group);
    state.groups.push(group);
  }
  state.groups.sort((a, b) => b.createdAt - a.createdAt);
  populateSettingsForm();
  render();
  showToast('Workspace imported');
}

async function resetWorkspace() {
  if (!confirm('Reset this browser workspace? Imported copies and metadata will be deleted. Apple Photos and eBay will not be affected.')) return;
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
  $(`#${viewName}View`)?.classList.add('active');
  location.hash = viewName;
}

function saveApiSettings() {
  state.settings.apiBaseUrl = normalizeApiUrl(textValue('#apiBaseUrl'));
  persistSettings();
  state.apiStatus = null;
  renderApiBadge();
  showToast('API settings saved');
}

function saveEbayDefaults() {
  Object.assign(state.settings, {
    marketplaceId: $('#defaultMarketplace').value,
    merchantLocationKey: textValue('#defaultLocationKey'),
    fulfillmentPolicyId: textValue('#defaultFulfillmentPolicyId'),
    paymentPolicyId: textValue('#defaultPaymentPolicyId'),
    returnPolicyId: textValue('#defaultReturnPolicyId'),
  });
  persistSettings();
  showToast('eBay defaults saved');
}

function normalizeApiUrl(value) { return (value || '').replace(/\/+$/, ''); }
async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text }; }
}
function updateTitleLength() { $('#titleLength').textContent = $('#groupTitle').value.length; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }

function wireEvents() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => selectView(tab.dataset.view)));
  $('#photoPicker').addEventListener('change', (event) => importFiles(event.target.files).finally(() => { event.target.value = ''; }));
  $('#cameraPicker').addEventListener('change', (event) => importFiles(event.target.files).finally(() => { event.target.value = ''; }));
  $('#autoGroupButton').addEventListener('click', regroupInbox);
  $('#demoButton').addEventListener('click', createDemo);
  $('#groupForm').addEventListener('submit', saveDialogGroup);
  $('#deleteGroupButton').addEventListener('click', deleteCurrentGroup);
  $('#previewPayloadButton').addEventListener('click', previewCurrentForm);
  $('#groupTitle').addEventListener('input', updateTitleLength);
  $('#searchInput').addEventListener('input', renderDesktop);
  $('#statusFilter').addEventListener('change', renderDesktop);
  $('#checkApiButton').addEventListener('click', checkApiStatus);
  $('#settingsCheckApiButton').addEventListener('click', checkApiStatus);
  $('#publishReadyButton').addEventListener('click', publishAllReady);
  $('#analyzeAllButton').addEventListener('click', analyzeAll);
  $('#saveApiSettingsButton').addEventListener('click', saveApiSettings);
  $('#saveEbayDefaultsButton').addEventListener('click', saveEbayDefaults);
  $('#closePayloadButton').addEventListener('click', () => $('#payloadDialog').close());
  $('#copyPayloadButton').addEventListener('click', async () => { await navigator.clipboard.writeText($('#payloadPreview').textContent); showToast('Payload copied'); });
  $('#exportButton').addEventListener('click', exportWorkspace);
  $('#importPicker').addEventListener('change', async (event) => {
    try { if (event.target.files[0]) await importWorkspace(event.target.files[0]); }
    catch (error) { showToast(error.message); }
    finally { event.target.value = ''; }
  });
  $('#groupWindow').addEventListener('change', (event) => {
    state.settings.groupWindowMinutes = Math.max(1, Math.min(30, Number(event.target.value) || 4));
    event.target.value = state.settings.groupWindowMinutes;
    persistSettings();
  });
  $('#confirmCleanup').addEventListener('change', (event) => { state.settings.confirmCleanup = event.target.checked; persistSettings(); });
  $('#resetButton').addEventListener('click', resetWorkspace);
  $('#installButton').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    $('#installButton').classList.add('hidden');
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); state.deferredInstallPrompt = event; $('#installButton').classList.remove('hidden');
  });
}

wireEvents();
initialize().catch((error) => { console.error(error); showToast('Could not open the local product database'); });
const allowedViews = ['phone', 'desktop', 'publisher', 'optimizer', 'settings'];
const initialView = allowedViews.includes(location.hash.slice(1)) ? location.hash.slice(1) : (matchMedia('(max-width: 760px)').matches ? 'phone' : 'desktop');
selectView(initialView);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
