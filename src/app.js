const state = {
  meta: null,
  index: null,
  currentFile: null,
  currentShard: 0,
  manifest: null,
  records: [],
};

const $ = (id) => document.getElementById(id);
const els = {
  buildMeta: $('build-meta'),
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

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function n(value) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function card(title, meta, extra = '', data = '') {
  return `<button class="item" ${data}><div class="title">${esc(title)}</div><div class="meta">${esc(meta)}</div>${extra}</button>`;
}

function setDetail(record, file) {
  const ui = record._ui || {};
  const chips = [];
  for (const key of ['_key', 'groupID', 'categoryID', 'marketGroupID', 'factionID', 'raceID', 'published']) {
    if (record[key] !== undefined) {
      chips.push(`<div class="chip"><span>${esc(key)}</span><strong>${esc(record[key])}</strong></div>`);
    }
  }
  els.detailTag.textContent = `${file} · ${ui.key || record._key || 'record'}`;
  els.detailCard.classList.remove('empty');
  els.detailCard.innerHTML = `
    <div class="summary">
      <div class="title">${esc(ui.title || '未命名记录')}</div>
      <div class="meta">${esc(ui.summary || '')}</div>
    </div>
    <div class="chips">${chips.join('')}</div>
    <pre>${esc(JSON.stringify(record, null, 2))}</pre>
  `;
}

function renderRecords(records, file) {
  if (!records.length) {
    els.recordList.innerHTML = card('这一页没有数据', '试试切换页码，或者换一个文件。');
    return;
  }
  els.recordList.innerHTML = records.map((record, i) => {
    const ui = record._ui || {};
    return card(ui.title || record._key || 'record', ui.summary || `${file} · ${ui.key || ''}`, '', `data-record-index="${i}"`);
  }).join('');
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

  els.metricCurrent.textContent = file;
  els.viewerTitle.textContent = file;
  els.viewerSubtitle.textContent = `共 ${n(manifest.records)} 条记录，当前第 ${shard + 1} / ${manifest.shards} 分片。`;
  els.viewerToolbar.classList.remove('hidden');
  els.viewerToolbar.textContent = `高频字段：${(manifest.topFields || []).join(' · ')}`;
  els.prevPage.disabled = shard <= 0;
  els.nextPage.disabled = shard >= manifest.shards - 1;
  renderRecords(records, file);
  if (records[0]) setDetail(records[0], file);
}

async function ensureIndex() {
  if (!state.index) {
    els.searchStatus.textContent = '正在加载搜索索引…';
    state.index = await loadJson('./data/search-index.json');
    els.searchStatus.textContent = `索引已载入，可搜索 ${n(state.index.entries.length)} 条记录。`;
  }
  return state.index;
}

function score(entry, query) {
  const q = entry.q || '';
  const title = (entry.title || '').toLowerCase();
  if (title === query) return 100;
  if (title.startsWith(query)) return 90;
  if (q.startsWith(query)) return 80;
  if (title.includes(query)) return 70;
  if (q.includes(query)) return 50;
  return 0;
}

function renderSearchResults(results) {
  if (!results.length) {
    els.searchResults.innerHTML = card('没有找到匹配项', '试试换一个关键词、名称或 ID。');
    return;
  }
  els.searchResults.innerHTML = results.map((item, i) => card(item.title, item.summary, '', `data-result-index="${i}"`)).join('');
  els.searchResults.querySelectorAll('[data-result-index]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = results[Number(btn.dataset.resultIndex)];
      const manifest = await loadJson(`./data/files/${item.file}/manifest.json`);
      for (let shard = 0; shard < manifest.shards; shard += 1) {
        const records = await loadJson(`./data/files/${item.file}/${shard}.json`);
        const found = records.find((r) => String(r._ui?.key ?? r._key) === String(item.key));
        if (found) {
          state.currentFile = item.file;
          state.currentShard = shard;
          state.manifest = manifest;
          state.records = records;
          els.metricCurrent.textContent = item.file;
          els.viewerTitle.textContent = item.file;
          els.viewerSubtitle.textContent = `从搜索结果定位到 key=${item.key}，所在分片 ${shard + 1} / ${manifest.shards}。`;
          els.viewerToolbar.classList.remove('hidden');
          els.viewerToolbar.textContent = `高频字段：${(manifest.topFields || []).join(' · ')}`;
          els.prevPage.disabled = shard <= 0;
          els.nextPage.disabled = shard >= manifest.shards - 1;
          renderRecords(records, item.file);
          setDetail(found, item.file);
          return;
        }
      }
      els.searchStatus.textContent = `找到索引项，但没有在分片中定位到 ${item.file} / ${item.key}`;
    });
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

function renderFiles(files) {
  els.fileCount.textContent = n(files.length);
  els.fileList.innerHTML = files.map((file) => {
    return card(file.file, `${n(file.records)} 条记录 · ${file.shards} 个分片`, '', `data-file="${esc(file.file)}"`);
  }).join('');
  els.fileList.querySelectorAll('[data-file]').forEach((btn) => {
    btn.addEventListener('click', () => openShard(btn.dataset.file, 0));
  });
}

async function init() {
  try {
    state.meta = await loadJson('./data/meta.json');
    const generated = new Date(state.meta.generatedAt).toLocaleString('zh-CN', { hour12: false });
    document.title = state.meta.siteTitle || 'EVE SDE Browser';
    els.buildMeta.textContent = `Build ${state.meta.buildNumber} · ${state.meta.variant.toUpperCase()} · ${generated}`;
    els.metricBuild.textContent = state.meta.buildNumber;
    els.metricFiles.textContent = n(state.meta.fileCount);
    renderFiles(state.meta.files || []);
    if (state.meta.files?.[0]) await openShard(state.meta.files[0].file, 0);
  } catch (error) {
    console.error(error);
    els.buildMeta.textContent = '加载失败';
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
