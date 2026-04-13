const state = {
  meta: null,
  game: null,
  index: null,
  currentFile: null,
  currentShard: 0,
  manifest: null,
  records: [],
};

const $ = (id) => document.getElementById(id);
const els = {
  buildMeta: $('build-meta'),
  translationMeta: $('translation-meta'),
  metricBuild: $('metric-build'),
  metricFiles: $('metric-files'),
  metricCurrent: $('metric-current'),
  fileCount: $('file-count'),
  fileList: $('file-list'),
  searchInput: $('search-input'),
  searchStatus: $('search-status'),
  searchResults: $('search-results'),
  viewerTitle: $('viewer-title'),
  viewerSubtitle: $('viewer-subtitle'),
  viewerToolbar: $('viewer-toolbar'),
  recordList: $('record-list'),
  detailCard: $('detail-card'),
  detailTag: $('detail-tag'),
  prevPage: $('prev-page'),
  nextPage: $('next-page'),
};

const FILE_GROUPS = [
  { title: '物品与市场', test: (file) => ['types', 'groups', 'categories', 'marketGroups', 'metaGroups', 'typeMaterials'].includes(file) },
  { title: 'Dogma 与装配规则', test: (file) => file.startsWith('dogma') || file === 'dynamicItemAttributes' },
  { title: '宇宙星图', test: (file) => file.startsWith('map') || file === 'landmarks' },
  { title: 'NPC 与势力', test: (file) => file.includes('npc') || ['factions', 'races', 'bloodlines', 'ancestries', 'agentsInSpace', 'agentTypes'].includes(file) },
  { title: '工业与蓝图', test: (file) => ['blueprints', 'schematics', 'planetSchematics', 'planetResources'].includes(file) },
  { title: '空间站与设施', test: (file) => file.includes('station') || file.includes('Station') || file.includes('sovereignty') },
  { title: '资源与表现', test: (file) => ['icons', 'graphics', 'skins', 'skinLicenses'].includes(file) },
];

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function n(value) {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0);
}

function card(title, meta, extra = '', data = '') {
  return `<button class="item" ${data}><div class="title">${esc(title)}</div><div class="meta">${esc(meta)}</div>${extra}</button>`;
}

function shortDescription(value, length = 180) {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length - 3)}...` : value;
}

function rawTitle(record, fallback = '未命名记录') {
  return record?._ui?.title || record?._key || fallback;
}

function findType(typeID) {
  return state.game?.typeIndex?.[String(typeID)] || null;
}

function typeLine(type) {
  const bits = [];
  if (type.categoryName) bits.push(type.categoryName);
  if (type.groupName) bits.push(type.groupName);
  if (type.marketPath?.length) bits.push(type.marketPath.join(' / '));
  return bits.join(' · ');
}

function buildRecordContext(record) {
  const ui = record._ui || {};
  const blocks = [];
  const type = findType(ui.key);
  if (type && state.currentFile === 'types') {
    blocks.push(`
      <section class="summary">
        <div class="section-subtitle">物品关联</div>
        <div class="chips">
          ${type.published ? '<span class="pill ok">已发布</span>' : '<span class="pill warn">未发布</span>'}
          ${type.categoryName ? `<span class="pill">${esc(type.categoryName)}</span>` : ''}
          ${type.groupName ? `<span class="pill">${esc(type.groupName)}</span>` : ''}
        </div>
        ${type.marketPath?.length ? `<div class="path">${esc(type.marketPath.join(' / '))}</div>` : ''}
        ${type.description ? `<p class="detail-text">${esc(shortDescription(type.description, 260))}</p>` : ''}
        <div class="id-grid">
          <div><span>typeID</span><strong>${esc(type.id)}</strong></div>
          <div><span>groupID</span><strong>${esc(type.groupID || '-')}</strong></div>
          <div><span>categoryID</span><strong>${esc(type.categoryID || '-')}</strong></div>
          <div><span>marketGroupID</span><strong>${esc(type.marketGroupID || '-')}</strong></div>
        </div>
      </section>
    `);
  }
  if (ui.marketPath?.length && state.currentFile !== 'types') {
    blocks.push(`
      <section class="summary">
        <div class="section-subtitle">市场路径</div>
        <div class="path">${esc(ui.marketPath.join(' / '))}</div>
      </section>
    `);
  }
  if (ui.location) {
    const loc = ui.location;
    blocks.push(`
      <section class="summary">
        <div class="section-subtitle">位置关联</div>
        <div class="path">${esc([loc.regionName, loc.constellationName, loc.name].filter(Boolean).join(' / '))}</div>
        ${loc.security !== undefined && loc.security !== null ? `<div class="meta">安全等级：${Number(loc.security).toFixed(3)}</div>` : ''}
      </section>
    `);
  }
  if (record.solarSystemID && state.currentFile === 'npcStations') {
    blocks.push(`
      <section class="summary">
        <div class="section-subtitle">空间站关联</div>
        <div class="id-grid">
          <div><span>stationID</span><strong>${esc(record._ui?.key || record._key)}</strong></div>
          <div><span>solarSystemID</span><strong>${esc(record.solarSystemID)}</strong></div>
          <div><span>typeID</span><strong>${esc(record.typeID || '-')}</strong></div>
          <div><span>operationID</span><strong>${esc(record.operationID || '-')}</strong></div>
        </div>
      </section>
    `);
  }
  return blocks.join('');
}

function detailPairs(record) {
  const notes = record._ui?.fieldNotes || [];
  return notes
    .map((item) => `
      <div class="field-row">
        <div>
          <div class="field-label">${esc(item.label)}</div>
          <div class="field-key">${esc(item.key)}</div>
        </div>
        <div>
          <div class="field-preview">${esc(item.preview)}</div>
          <div class="field-meaning">${esc(item.meaning)}</div>
        </div>
      </div>
    `)
    .join('');
}

function setDetail(record, file) {
  const ui = record._ui || {};
  const topMeta = [];
  if (ui.fileLabel) topMeta.push(ui.fileLabel);
  if (ui.key) topMeta.push(`键值 ${ui.key}`);
  els.detailTag.textContent = topMeta.join(' · ') || file;
  els.detailCard.classList.remove('empty');
  els.detailCard.innerHTML = `
    <section class="summary">
      <div class="title">${esc(ui.title || '未命名记录')}</div>
      ${ui.altTitle ? `<div class="alt-title">原名：${esc(ui.altTitle)}</div>` : ''}
      ${ui.localizedDescription ? `<p class="detail-text">${esc(shortDescription(ui.localizedDescription, 260))}</p>` : ''}
      <div class="meta">${esc(ui.summary || '')}</div>
      <div class="muted small">${esc(ui.fileDesc || '')}</div>
    </section>
    ${buildRecordContext(record)}
    <section class="section-block">
      <div class="section-subtitle">字段释义</div>
      <div class="field-list">${detailPairs(record)}</div>
    </section>
    <section class="section-block">
      <div class="section-subtitle">原始 JSON</div>
      <pre>${esc(JSON.stringify(record, null, 2))}</pre>
    </section>
  `;
}

function renderRecords(records, file) {
  if (!records.length) {
    els.recordList.innerHTML = card('这一页没有数据', '试试切换分片，或者换一个文件。');
    return;
  }
  els.recordList.innerHTML = records
    .map((record, i) => {
      const ui = record._ui || {};
      const extraLines = [];
      if (ui.altTitle) extraLines.push(`原名：${ui.altTitle}`);
      const type = file === 'types' ? findType(ui.key) : null;
      if (type) extraLines.push(typeLine(type));
      if (ui.location) extraLines.push([ui.location.regionName, ui.location.constellationName].filter(Boolean).join(' / '));
      const extra = extraLines.filter(Boolean).map((line) => `<div class="meta">${esc(line)}</div>`).join('');
      return card(rawTitle(record), ui.summary || `${file} · ${ui.key || ''}`, extra, `data-record-index="${i}"`);
    })
    .join('');
  els.recordList.querySelectorAll('[data-record-index]').forEach((btn) => {
    btn.addEventListener('click', () => setDetail(records[Number(btn.dataset.recordIndex)], file));
  });
}

async function openShard(file, shard = 0) {
  const manifest = await loadJson(`./data/files/${file}/manifest.json`);
  const records = await loadJson(`./data/files/${file}/${shard}.json`);
  state.currentFile = file;
  state.currentShard = shard;
  state.manifest = manifest;
  state.records = records;
  els.metricCurrent.textContent = manifest.title || file;
  els.viewerTitle.textContent = manifest.title || file;
  els.viewerSubtitle.textContent = `${manifest.description || '官方 SDE 数据文件'} · 共 ${n(manifest.records)} 条记录，当前第 ${shard + 1} / ${manifest.shards} 个分片。`;
  els.viewerToolbar.classList.remove('hidden');
  els.viewerToolbar.textContent = `高频字段：${(manifest.topFields || []).join(' · ')}`;
  els.prevPage.disabled = shard <= 0;
  els.nextPage.disabled = shard >= manifest.shards - 1;
  renderRecords(records, file);
  if (records[0]) setDetail(records[0], file);
}

async function ensureIndex() {
  if (!state.index) {
    els.searchStatus.textContent = '正在加载搜索索引...';
    state.index = await loadJson('./data/search-index.json');
    els.searchStatus.textContent = `索引已载入，可搜索 ${n(state.index.entries.length)} 条记录。`;
  }
  return state.index;
}

function score(entry, query) {
  const q = (entry.q || '').toLowerCase();
  const title = (entry.title || '').toLowerCase();
  const alt = (entry.altTitle || '').toLowerCase();
  if (title === query) return 120;
  if (alt === query) return 110;
  if (title.startsWith(query)) return 100;
  if (alt.startsWith(query)) return 95;
  if (q.startsWith(query)) return 85;
  if (title.includes(query)) return 75;
  if (alt.includes(query)) return 70;
  if (q.includes(query)) return 55;
  return 0;
}

async function locateSearchResult(item) {
  const manifest = await loadJson(`./data/files/${item.file}/manifest.json`);
  for (let shard = 0; shard < manifest.shards; shard += 1) {
    const records = await loadJson(`./data/files/${item.file}/${shard}.json`);
    const found = records.find((r) => String(r._ui?.key ?? r._key) === String(item.key));
    if (found) {
      state.currentFile = item.file;
      state.currentShard = shard;
      state.manifest = manifest;
      state.records = records;
      els.metricCurrent.textContent = manifest.title || item.file;
      els.viewerTitle.textContent = manifest.title || item.file;
      els.viewerSubtitle.textContent = `已从搜索结果定位到该记录，位于第 ${shard + 1} / ${manifest.shards} 个分片。`;
      els.viewerToolbar.classList.remove('hidden');
      els.viewerToolbar.textContent = `高频字段：${(manifest.topFields || []).join(' · ')}`;
      els.prevPage.disabled = shard <= 0;
      els.nextPage.disabled = shard >= manifest.shards - 1;
      renderRecords(records, item.file);
      setDetail(found, item.file);
      return;
    }
  }
  els.searchStatus.textContent = `已命中搜索索引，但没有在分片中定位到 ${item.file} / ${item.key}`;
}

function renderSearchResults(results) {
  if (!results.length) {
    els.searchResults.innerHTML = card('没有找到匹配项', '试试中文名、英文名、ID、字段名或 SDE 文件名。');
    return;
  }
  els.searchResults.innerHTML = results
    .map((item, i) => {
      const extra = item.altTitle ? `<div class="meta">原名：${esc(item.altTitle)}</div>` : '';
      return card(item.title, `${item.fileLabel || item.file} · ${item.summary}`, extra, `data-result-index="${i}"`);
    })
    .join('');
  els.searchResults.querySelectorAll('[data-result-index]').forEach((btn) => {
    btn.addEventListener('click', () => locateSearchResult(results[Number(btn.dataset.resultIndex)]));
  });
}

async function onSearch() {
  const raw = els.searchInput.value.trim().toLowerCase();
  if (!raw) {
    els.searchResults.innerHTML = '';
    els.searchStatus.textContent = '';
    return;
  }
  const index = await ensureIndex();
  if (raw.length < (index.minimumQueryLength || 2)) {
    els.searchStatus.textContent = `至少输入 ${index.minimumQueryLength || 2} 个字符。`;
    els.searchResults.innerHTML = '';
    return;
  }
  const ranked = index.entries
    .map((entry) => ({ entry, s: score(entry, raw) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.entry.title.localeCompare(b.entry.title, 'zh-CN'))
    .slice(0, 100)
    .map((x) => x.entry);
  els.searchStatus.textContent = `找到 ${n(ranked.length)} 条匹配结果。`;
  renderSearchResults(ranked);
}

function groupFiles(files) {
  const groups = FILE_GROUPS.map((group) => ({ title: group.title, test: group.test, files: [] }));
  const other = { title: '其他 SDE 文件', files: [] };
  for (const file of files) {
    const target = groups.find((group) => group.test(file.file));
    if (target) target.files.push(file);
    else other.files.push(file);
  }
  return [...groups.filter((group) => group.files.length), ...(other.files.length ? [other] : [])];
}

function renderFiles(files) {
  els.fileCount.textContent = n(files.length);
  els.fileList.innerHTML = groupFiles(files)
    .map((group) => `
      <div class="file-group">
        <div class="file-group-title">${esc(group.title)}</div>
        ${group.files
          .map((file) => card(file.title || file.file, `${n(file.records)} 条记录 · ${file.shards} 个分片`, `<div class="meta">${esc(file.description || '')}</div>`, `data-file="${esc(file.file)}"`))
          .join('')}
      </div>
    `)
    .join('');
  els.fileList.querySelectorAll('[data-file]').forEach((btn) => {
    btn.addEventListener('click', () => openShard(btn.dataset.file, 0));
  });
}

function renderTranslationMeta(meta) {
  const info = meta?.translationMeta;
  if (!info) {
    els.translationMeta.textContent = '当前构建未提供额外的汉化元数据。';
    return;
  }
  const workbook = info.externalTranslationWorkbook;
  if (workbook?.status === 'loaded') {
    const sheets = (workbook.sheetsApplied || []).join('、');
    els.translationMeta.textContent = `汉化策略：官方 SDE 中文优先，缺中文时使用 CEVE 兜底（${sheets || '已应用'}）。`;
    return;
  }
  if (workbook?.status === 'failed') {
    els.translationMeta.textContent = `汉化策略：官方 SDE 中文优先，CEVE 兜底表加载失败：${workbook.reason}`;
    return;
  }
  els.translationMeta.textContent = info.sdeLocalizedText || '汉化策略：官方 SDE 中文优先。';
}

async function init() {
  try {
    state.meta = await loadJson('./data/meta.json');
    state.game = await loadJson('./data/game-data.json');
    const generated = new Date(state.meta.generatedAt).toLocaleString('zh-CN', { hour12: false });
    document.title = state.meta.siteTitle || 'EVE SDE 中文资料站';
    els.buildMeta.textContent = `Build ${state.meta.buildNumber} · ${state.meta.variant.toUpperCase()} · ${generated}`;
    renderTranslationMeta(state.meta);
    els.metricBuild.textContent = state.meta.buildNumber;
    els.metricFiles.textContent = n(state.meta.fileCount);
    renderFiles(state.meta.files || []);
    const firstUseful = (state.meta.files || []).find((file) => file.file === 'types') || state.meta.files?.[0];
    if (firstUseful) await openShard(firstUseful.file, 0);
  } catch (error) {
    console.error(error);
    els.buildMeta.textContent = '加载失败';
    els.translationMeta.textContent = '页面初始化失败。';
    els.recordList.innerHTML = card('站点初始化失败', error.message);
  }
}

els.searchInput.addEventListener('input', onSearch);
els.prevPage.addEventListener('click', () => {
  if (!state.currentFile || state.currentShard <= 0) return;
  openShard(state.currentFile, state.currentShard - 1);
});
els.nextPage.addEventListener('click', () => {
  if (!state.currentFile || !state.manifest || state.currentShard >= state.manifest.shards - 1) return;
  openShard(state.currentFile, state.currentShard + 1);
});

init();
