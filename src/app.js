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
  tabMarket: $('tab-market'),
  tabUniverse: $('tab-universe'),
  tabRaw: $('tab-raw'),
};

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

function setMode(mode) {
  for (const [name, button] of [
    ['market', els.tabMarket],
    ['universe', els.tabUniverse],
    ['raw', els.tabRaw],
  ]) {
    button.classList.toggle('active', name === mode);
  }
  els.prevPage.classList.toggle('hidden', mode !== 'raw');
  els.nextPage.classList.toggle('hidden', mode !== 'raw');
}

function shortDescription(value) {
  if (!value) return '';
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function typeLine(type) {
  const bits = [];
  if (type.categoryName) bits.push(type.categoryName);
  if (type.groupName) bits.push(type.groupName);
  if (type.marketPath?.length) bits.push(type.marketPath.join(' / '));
  if (type.en) bits.push(type.en);
  return bits.join(' · ');
}

function renderTypeDetail(type) {
  els.detailTag.textContent = `物品 ${type.id}`;
  els.detailCard.classList.remove('empty');
  els.detailCard.innerHTML = `
    <section class="summary">
      <div class="title">${esc(type.name || `物品 ${type.id}`)}</div>
      ${type.en ? `<div class="alt-title">英文原名：${esc(type.en)}</div>` : ''}
      <div class="chips">
        ${type.published ? '<span class="pill ok">已发布</span>' : '<span class="pill warn">未发布</span>'}
        ${type.categoryName ? `<span class="pill">${esc(type.categoryName)}</span>` : ''}
        ${type.groupName ? `<span class="pill">${esc(type.groupName)}</span>` : ''}
      </div>
      ${type.marketPath?.length ? `<div class="path">${esc(type.marketPath.join(' / '))}</div>` : ''}
      ${type.description ? `<p class="detail-text">${esc(shortDescription(type.description))}</p>` : ''}
    </section>
    <section class="section-block">
      <div class="section-subtitle">常用 ID</div>
      <div class="id-grid">
        <div><span>typeID</span><strong>${esc(type.id)}</strong></div>
        <div><span>groupID</span><strong>${esc(type.groupID || '-')}</strong></div>
        <div><span>categoryID</span><strong>${esc(type.categoryID || '-')}</strong></div>
        <div><span>marketGroupID</span><strong>${esc(type.marketGroupID || '-')}</strong></div>
      </div>
    </section>
  `;
}

function renderTypeList(typeIDs, title, subtitle) {
  const types = typeIDs.map((id) => state.game.typeIndex[id]).filter(Boolean);
  els.viewerTitle.textContent = title;
  els.viewerSubtitle.textContent = `${subtitle} · 共 ${n(types.length)} 个物品`;
  els.viewerToolbar.classList.add('hidden');
  els.recordList.innerHTML = types.length
    ? types
        .slice(0, 500)
        .map((type) => card(type.name, typeLine(type), type.description ? `<div class="meta">${esc(shortDescription(type.description))}</div>` : '', `data-type-id="${esc(type.id)}"`))
        .join('')
    : card('这里还没有直接挂载物品', '继续展开子分类，或换一个分类查看。');
  if (types.length > 500) {
    els.recordList.innerHTML += `<div class="notice">结果较多，当前先显示前 500 条。可以用左侧搜索精确定位。</div>`;
  }
  els.recordList.querySelectorAll('[data-type-id]').forEach((btn) => {
    btn.addEventListener('click', () => renderTypeDetail(state.game.typeIndex[btn.dataset.typeId]));
  });
  if (types[0]) renderTypeDetail(types[0]);
}

function marketNodeCount(node) {
  let total = node.typeIDs?.length || 0;
  for (const child of node.children || []) total += marketNodeCount(child);
  return total;
}

function renderMarketNode(node, trail = []) {
  setMode('market');
  state.currentFile = null;
  const path = [...trail, node.name].filter((item) => item && item !== '市场');
  els.metricCurrent.textContent = path.at(-1) || '市场';
  els.viewerTitle.textContent = path.length ? path.at(-1) : '市场分类';
  els.viewerSubtitle.textContent = path.length
    ? path.join(' / ')
    : '按 CEVE 市场分类路径整理，更接近游戏内市场浏览方式。';
  els.viewerToolbar.classList.remove('hidden');
  els.viewerToolbar.textContent = `当前层级包含 ${n(marketNodeCount(node))} 个物品。`;
  const children = node.children || [];
  const childCards = children
    .map((child, index) => card(child.name, `${n(marketNodeCount(child))} 个物品`, '', `data-market-child="${index}"`))
    .join('');
  const direct = node.typeIDs?.length
    ? card('查看本分类物品', `${n(node.typeIDs.length)} 个直接挂载物品`, '', 'data-market-types="1"')
    : '';
  els.recordList.innerHTML = childCards || direct ? direct + childCards : card('没有子分类', '这个分类下没有可浏览的市场物品。');
  els.recordList.querySelectorAll('[data-market-child]').forEach((btn) => {
    btn.addEventListener('click', () => renderMarketNode(children[Number(btn.dataset.marketChild)], path));
  });
  const typeButton = els.recordList.querySelector('[data-market-types]');
  if (typeButton) typeButton.addEventListener('click', () => renderTypeList(node.typeIDs || [], path.at(-1) || '市场物品', path.join(' / ')));
  els.detailTag.textContent = '市场';
  els.detailCard.classList.remove('empty');
  els.detailCard.innerHTML = `
    <section class="summary">
      <div class="title">${esc(path.at(-1) || '市场分类')}</div>
      <div class="meta">${esc(path.join(' / ') || '市场根目录')}</div>
      <p class="detail-text">先按市场分类缩小范围，再查看具体物品。这个入口优先使用 CEVE 表格里的中文市场路径。</p>
    </section>
  `;
}

function renderSystemDetail(system, region, constellation) {
  els.detailTag.textContent = `星系 ${system.id}`;
  els.detailCard.classList.remove('empty');
  els.detailCard.innerHTML = `
    <section class="summary">
      <div class="title">${esc(system.name)}</div>
      <div class="chips">
        <span class="pill">${esc(system.securityBand || '未知')}</span>
        <span class="pill">${Number(system.security ?? 0).toFixed(3)}</span>
      </div>
      <div class="path">${esc(region.name)} / ${esc(constellation.name)} / ${esc(system.name)}</div>
    </section>
    <section class="section-block">
      <div class="section-subtitle">NPC 空间站</div>
      <div class="mini-list">
        ${(system.stations || []).map((station) => `<div>${esc(station.name)} <span>${esc(station.id)}</span></div>`).join('') || '<div>无记录</div>'}
      </div>
    </section>
    <section class="section-block">
      <div class="section-subtitle">玩家公开建筑</div>
      <div class="mini-list">
        ${(system.structures || []).map((item) => `<div>${esc(item.name)} <span>${esc(item.type || '')} · ${esc(item.id)}</span></div>`).join('') || '<div>无记录</div>'}
      </div>
    </section>
  `;
}

function renderUniverse(region = null, constellation = null) {
  setMode('universe');
  state.currentFile = null;
  if (!region) {
    els.metricCurrent.textContent = '星图';
    els.viewerTitle.textContent = '星域';
    els.viewerSubtitle.textContent = '按 CEVE 星域、星座、星系、空间站和公开建筑数据整理。';
    els.viewerToolbar.classList.remove('hidden');
    els.viewerToolbar.textContent = `共 ${n(state.game.counts.regions)} 个星域，${n(state.game.counts.stations)} 个 NPC 空间站，${n(state.game.counts.structures)} 个公开建筑。`;
    els.recordList.innerHTML = state.game.universe
      .map((item, index) => card(item.name, `${n(item.constellations.length)} 个星座`, '', `data-region="${index}"`))
      .join('');
    els.recordList.querySelectorAll('[data-region]').forEach((btn) => {
      btn.addEventListener('click', () => renderUniverse(state.game.universe[Number(btn.dataset.region)]));
    });
    els.detailTag.textContent = '星图';
    els.detailCard.classList.add('empty');
    els.detailCard.textContent = '选择一个星域后继续查看星座与星系。';
    return;
  }
  if (!constellation) {
    els.metricCurrent.textContent = region.name;
    els.viewerTitle.textContent = region.name;
    els.viewerSubtitle.textContent = `星域 ID ${region.id}`;
    els.viewerToolbar.textContent = `共 ${n(region.constellations.length)} 个星座。`;
    els.recordList.innerHTML = region.constellations
      .map((item, index) => card(item.name, `${n(item.systems.length)} 个星系`, '', `data-constellation="${index}"`))
      .join('');
    els.recordList.querySelectorAll('[data-constellation]').forEach((btn) => {
      btn.addEventListener('click', () => renderUniverse(region, region.constellations[Number(btn.dataset.constellation)]));
    });
    return;
  }
  els.metricCurrent.textContent = constellation.name;
  els.viewerTitle.textContent = constellation.name;
  els.viewerSubtitle.textContent = `${region.name} / ${constellation.name}`;
  els.viewerToolbar.textContent = `共 ${n(constellation.systems.length)} 个星系。`;
  els.recordList.innerHTML = constellation.systems
    .map((system, index) => {
      const extra = `<div class="meta">${esc(system.securityBand)} · NPC站 ${n(system.stations?.length || 0)} · 公开建筑 ${n(system.structures?.length || 0)}</div>`;
      return card(system.name, `安全等级 ${Number(system.security ?? 0).toFixed(3)} · 星系 ID ${system.id}`, extra, `data-system="${index}"`);
    })
    .join('');
  els.recordList.querySelectorAll('[data-system]').forEach((btn) => {
    btn.addEventListener('click', () => renderSystemDetail(constellation.systems[Number(btn.dataset.system)], region, constellation));
  });
  if (constellation.systems[0]) renderSystemDetail(constellation.systems[0], region, constellation);
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
      ${ui.altTitle ? `<div class="alt-title">英文原名：${esc(ui.altTitle)}</div>` : ''}
      ${ui.marketPath?.length ? `<div class="path">${esc(ui.marketPath.join(' / '))}</div>` : ''}
      ${ui.localizedDescription ? `<p class="detail-text">${esc(shortDescription(ui.localizedDescription))}</p>` : ''}
      <div class="meta">${esc(ui.summary || '')}</div>
      <div class="muted small">${esc(ui.fileDesc || '')}</div>
    </section>
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
      const extra = ui.altTitle ? `<div class="meta">${esc(ui.altTitle)}</div>` : '';
      return card(ui.title || record._key || 'record', ui.summary || `${file} · ${ui.key || ''}`, extra, `data-record-index="${i}"`);
    })
    .join('');
  els.recordList.querySelectorAll('[data-record-index]').forEach((btn) => {
    btn.addEventListener('click', () => setDetail(records[Number(btn.dataset.recordIndex)], file));
  });
}

async function openShard(file, shard = 0) {
  setMode('raw');
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

function renderSearchResults(results) {
  if (!results.length) {
    els.searchResults.innerHTML = card('没有找到匹配项', '试试中文名、英文名、ID、星系名或市场分类。');
    return;
  }
  els.searchResults.innerHTML = results
    .map((item, i) => {
      const extra = item.altTitle ? `<div class="meta">${esc(item.altTitle)}</div>` : '';
      return card(item.title, `${item.fileLabel || item.file} · ${item.summary}`, extra, `data-result-index="${i}"`);
    })
    .join('');
  els.searchResults.querySelectorAll('[data-result-index]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = results[Number(btn.dataset.resultIndex)];
      const type = state.game.typeIndex[item.key];
      if (type && item.file === 'types') {
        renderTypeList([item.key], item.title, '搜索结果');
        renderTypeDetail(type);
        return;
      }
      const manifest = await loadJson(`./data/files/${item.file}/manifest.json`);
      for (let shard = 0; shard < manifest.shards; shard += 1) {
        const records = await loadJson(`./data/files/${item.file}/${shard}.json`);
        const found = records.find((r) => String(r._ui?.key ?? r._key) === String(item.key));
        if (found) {
          state.currentFile = item.file;
          state.currentShard = shard;
          state.manifest = manifest;
          state.records = records;
          setMode('raw');
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
  els.fileList.innerHTML = files
    .map((file) => card(file.title || file.file, `${n(file.records)} 条记录 · ${file.shards} 个分片`, `<div class="meta">${esc(file.description || '')}</div>`, `data-file="${esc(file.file)}"`))
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
    els.translationMeta.textContent = `汉化策略：官方中文优先，CEVE 对照表已加载（${sheets || '已应用'}）。`;
    return;
  }
  if (workbook?.status === 'failed') {
    els.translationMeta.textContent = `汉化策略：官方中文优先，外部中文对照表加载失败：${workbook.reason}`;
    return;
  }
  els.translationMeta.textContent = info.sdeLocalizedText || '汉化策略：官方中文优先。';
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
    renderMarketNode(state.game.marketTree);
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
els.tabMarket.addEventListener('click', () => renderMarketNode(state.game.marketTree));
els.tabUniverse.addEventListener('click', () => renderUniverse());
els.tabRaw.addEventListener('click', () => {
  if (state.currentFile) openShard(state.currentFile, state.currentShard);
  else if (state.meta.files?.[0]) openShard(state.meta.files[0].file, 0);
});

init();
