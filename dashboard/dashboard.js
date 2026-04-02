let allVideos = [];
let selectedVideoIds = new Set();
let searchQuery = "";
let currentSort = "date-desc";
let currentDurationFilter = null;

let appSettings = {
  autoCollapse: false,
  apiKey: ''
};

// Undo state
let undoStack = null;
let undoTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  init();
});

// ---- Debounce utility ----
function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// ---- Settings ----
async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  if (settings) appSettings = { ...appSettings, ...settings };
  document.getElementById('auto-collapse-toggle').checked = appSettings.autoCollapse;
  document.getElementById('api-key-input').value = appSettings.apiKey;
  document.getElementById('btn-clear-api').classList.toggle('hidden', !appSettings.apiKey);
}

async function saveSettings() {
  await chrome.storage.local.set({ settings: appSettings });
  document.getElementById('btn-clear-api').classList.toggle('hidden', !appSettings.apiKey);
}

// ---- Init ----
async function init() {
  await loadSettings();
  bindControls();
  showSkeletons();
  await loadVideos();

  chrome.storage.local.get("apiError").then(({ apiError }) => {
    if (apiError) document.getElementById('api-error-banner').classList.remove('hidden');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.savedVideos) {
        allVideos = changes.savedVideos.newValue || [];
        const currentIds = new Set(allVideos.map(v => v.videoId));
        for (const id of selectedVideoIds) {
          if (!currentIds.has(id)) selectedVideoIds.delete(id);
        }
        processAndRender();
      }
      if (changes.apiError) {
        const banner = document.getElementById('api-error-banner');
        if (changes.apiError.newValue) banner.classList.remove('hidden');
        else banner.classList.add('hidden');
      }
    }
  });
}

// ---- Skeleton Loader ----
function showSkeletons(count = 8) {
  const grid = document.getElementById('video-grid');
  const section = document.getElementById('videos-section');
  section.classList.remove('hidden');
  grid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const sk = document.createElement('div');
    sk.className = 'skeleton-card';
    sk.innerHTML = `<div class="skeleton-thumb"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div>`;
    grid.appendChild(sk);
  }
}

// ---- Undo Toast ----
function showUndoToast(message, restoreFn) {
  clearTimeout(undoTimer);
  undoStack = restoreFn;

  const toast = document.getElementById('undo-toast');
  document.getElementById('undo-toast-msg').textContent = message;
  toast.classList.add('visible');

  undoTimer = setTimeout(() => {
    toast.classList.remove('visible');
    undoStack = null;
  }, 5000);
}

// ---- Controls ----
function bindControls() {
  // Settings Modal
  const settingsModal = document.getElementById('settings-modal');
  document.getElementById('btn-settings').addEventListener('click', () => settingsModal.showModal());
  document.getElementById('btn-close-settings').addEventListener('click', () => settingsModal.close());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal.open) { settingsModal.close(); return; }
    }
    if (e.key === 'Delete' && selectedVideoIds.size > 0 && document.activeElement.tagName !== 'INPUT') {
      document.getElementById('btn-delete-selected').click();
    }
  });

  // Undo button
  document.getElementById('btn-undo').addEventListener('click', async () => {
    if (undoStack) {
      await undoStack();
      undoStack = null;
      clearTimeout(undoTimer);
      document.getElementById('undo-toast').classList.remove('visible');
    }
  });

  // API Error Banner dismiss
  document.getElementById('btn-dismiss-banner').addEventListener('click', async () => {
    document.getElementById('api-error-banner').classList.add('hidden');
    await chrome.storage.local.set({ apiError: false });
  });

  // Settings
  document.getElementById('auto-collapse-toggle').addEventListener('change', async (e) => {
    appSettings.autoCollapse = e.target.checked;
    await saveSettings();
  });

  document.getElementById('btn-save-api').addEventListener('click', async () => {
    appSettings.apiKey = document.getElementById('api-key-input').value.trim();
    await saveSettings();
    const btn = document.getElementById('btn-save-api');
    btn.textContent = "Saved!";
    setTimeout(() => { btn.textContent = "Save Key"; }, 2000);
    await chrome.storage.local.set({ apiError: false });
    chrome.runtime.sendMessage({ action: "runEnrichment" });
  });

  document.getElementById('btn-clear-api').addEventListener('click', async () => {
    appSettings.apiKey = '';
    document.getElementById('api-key-input').value = '';
    await saveSettings();
    await chrome.storage.local.set({ apiError: false });
  });

  // Export JSON
  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(allVideos, null, 2)], { type: "application/json" });
    triggerDownload(blob, `foldtube_backup_${today()}.json`);
  });

  // Export HTML
  document.getElementById('btn-export-html').addEventListener('click', () => {
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FoldTube Backup — ${today()}</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #f1f1f1; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  p.sub { color: #aaa; font-size: 0.9rem; margin-top: 0; margin-bottom: 1.5rem; }
  ul { list-style: none; padding: 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #222; }
  img { width: 120px; border-radius: 4px; flex-shrink: 0; }
  .info a { color: #3ea6ff; text-decoration: none; font-weight: 600; }
  .info a:hover { text-decoration: underline; }
  .meta { color: #aaa; font-size: 0.85rem; margin-top: 4px; }
</style></head><body>
<h1>FoldTube Backup</h1>
<p class="sub">${allVideos.length} saved tabs · Exported ${new Date().toLocaleString()}</p>
<ul>`;
    allVideos.forEach(v => {
      html += `<li>
        <img src="https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg" alt="">
        <div class="info">
          <a href="${v.url}" target="_blank">${escapeHtml(v.title)}</a>
          <div class="meta">${escapeHtml(v.channelName)}${v.durationFormatted ? ` · ${v.durationFormatted}` : ''}</div>
        </div>
      </li>`;
    });
    html += `</ul></body></html>`;
    triggerDownload(new Blob([html], { type: "text/html" }), `foldtube_bookmarks_${today()}.html`);
  });

  // Import JSON
  document.getElementById('btn-import-trigger').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        const savedIds = new Set(allVideos.map(v => v.videoId));
        const newItems = imported.filter(v => v.videoId && !savedIds.has(v.videoId));
        await chrome.storage.local.set({ savedVideos: [...newItems, ...allVideos] });
        settingsModal.close();
        alert(`Imported ${newItems.length} new video${newItems.length === 1 ? '' : 's'}!`);
      } catch {
        alert("Failed to parse the JSON file. Please check it's a valid FoldTube backup.");
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // Search (debounced)
  document.getElementById('search-input').addEventListener('input', debounce((e) => {
    searchQuery = e.target.value.toLowerCase();
    processAndRender();
  }, 150));

  // Sort
  document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    processAndRender();
  });

  // Duration filter pills
  document.getElementById('duration-filters').addEventListener('click', (e) => {
    if (!e.target.classList.contains('filter-pill')) return;
    const isAllPill = e.target.dataset.all === "true";
    const isActive = e.target.classList.contains('active');
    document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
    if (isAllPill || isActive) {
      document.querySelector('.filter-pill[data-all="true"]').classList.add('active');
      currentDurationFilter = null;
    } else {
      e.target.classList.add('active');
      currentDurationFilter = { min: parseInt(e.target.dataset.min, 10), max: parseInt(e.target.dataset.max, 10) };
    }
    processAndRender();
  });

  // Bulk actions
  document.getElementById('btn-select-all').addEventListener('click', () => {
    getProcessedVideos().forEach(v => selectedVideoIds.add(v.videoId));
    updateSelectionBar();
    document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = true);
    document.querySelectorAll('.video-card').forEach(c => c.classList.add('selected'));
  });

  document.getElementById('btn-deselect-all').addEventListener('click', () => {
    selectedVideoIds.clear();
    updateSelectionBar();
    document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
    document.querySelectorAll('.video-card').forEach(c => c.classList.remove('selected'));
  });

  document.getElementById('btn-open-selected').addEventListener('click', async () => {
    if (!selectedVideoIds.size) return;
    if (selectedVideoIds.size > 10 && !confirm(`This will open ${selectedVideoIds.size} tabs. Continue?`)) return;
    allVideos.filter(v => selectedVideoIds.has(v.videoId)).forEach(v => chrome.tabs.create({ url: v.url, active: false }));
    const newVideos = allVideos.filter(v => !selectedVideoIds.has(v.videoId));
    selectedVideoIds.clear();
    updateSelectionBar();
    await chrome.storage.local.set({ savedVideos: newVideos });
  });

  document.getElementById('btn-delete-selected').addEventListener('click', async () => {
    if (!selectedVideoIds.size) return;
    const ids = new Set(selectedVideoIds);
    const count = ids.size;
    if (count > 1 && !confirm(`Delete ${count} selected videos?`)) return;
    const removed = allVideos.filter(v => ids.has(v.videoId));
    const newVideos = allVideos.filter(v => !ids.has(v.videoId));
    selectedVideoIds.clear();
    updateSelectionBar();
    await chrome.storage.local.set({ savedVideos: newVideos });
    showUndoToast(`${count} video${count > 1 ? 's' : ''} removed`, async () => {
      await chrome.storage.local.set({ savedVideos: [...removed, ...newVideos] });
    });
  });
}

// ---- Selection bar ----
function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const count = document.getElementById('selection-count');
  bar.classList.toggle('hidden', selectedVideoIds.size === 0);
  count.textContent = `${selectedVideoIds.size} selected`;
}

// ---- Load & Render ----
async function loadVideos() {
  try {
    const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
    allVideos = savedVideos;
    processAndRender();
  } catch (err) {
    console.error("Failed to load videos:", err);
    document.getElementById('videos-section').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  }
}

function getProcessedVideos() {
  let list = [...allVideos];
  if (searchQuery) {
    list = list.filter(v =>
      (v.title || '').toLowerCase().includes(searchQuery) ||
      (v.channelName || '').toLowerCase().includes(searchQuery) ||
      (v.description || '').toLowerCase().includes(searchQuery)
    );
  }
  if (currentDurationFilter) {
    list = list.filter(v => {
      const ds = v.durationSeconds || 0;
      return ds >= currentDurationFilter.min && ds < currentDurationFilter.max;
    });
  }
  list.sort((a, b) => {
    switch (currentSort) {
      case 'date-desc': return new Date(b.dateSaved) - new Date(a.dateSaved);
      case 'date-asc':  return new Date(a.dateSaved) - new Date(b.dateSaved);
      case 'dur-asc':   return (a.durationSeconds || 0) - (b.durationSeconds || 0);
      case 'dur-desc':  return (b.durationSeconds || 0) - (a.durationSeconds || 0);
      case 'chan-asc':  return (a.channelName || '').localeCompare(b.channelName || '');
      case 'chan-desc': return (b.channelName || '').localeCompare(a.channelName || '');
      case 'title-asc': return (a.title || '').localeCompare(b.title || '');
      default: return 0;
    }
  });
  return list;
}

function processAndRender() {
  try {
    const videos = getProcessedVideos();
    updateSelectionBar();

    const videoGrid = document.getElementById('video-grid');
    const shortsGrid = document.getElementById('shorts-grid');
    const videosSection = document.getElementById('videos-section');
    const shortsSection = document.getElementById('shorts-section');
    const emptyState = document.getElementById('empty-state');
    const videoCount = document.querySelector('.video-count');

    if (videos.length === 0) {
      videoGrid.innerHTML = '';
      shortsGrid.innerHTML = '';
      videosSection.classList.add('hidden');
      shortsSection.classList.add('hidden');
      emptyState.classList.remove('hidden');

      if (allVideos.length > 0) {
        emptyState.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <h2>No results</h2>
          <p>Try adjusting your search or filters</p>`;
        videoCount.textContent = `Showing 0 of ${allVideos.length} items`;
      } else {
        emptyState.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/></svg>
          <h2>Your library is empty</h2>
          <p>Press the FoldTube icon (or Ctrl+Shift+Y) to fold your open YouTube tabs</p>`;
        videoCount.textContent = '0 items';
      }
      return;
    }

    emptyState.classList.add('hidden');
    videoCount.textContent = allVideos.length !== videos.length
      ? `Showing ${videos.length} of ${allVideos.length} items`
      : `${videos.length} item${videos.length === 1 ? '' : 's'}`;

    videoGrid.innerHTML = '';
    shortsGrid.innerHTML = '';

    const standard = videos.filter(v => v.videoType !== 'short');
    const shorts = videos.filter(v => v.videoType === 'short');

    videosSection.classList.toggle('hidden', standard.length === 0);
    shortsSection.classList.toggle('hidden', shorts.length === 0);

    standard.forEach((v, i) => videoGrid.appendChild(createCard(v, i)));
    shorts.forEach((v, i) => shortsGrid.appendChild(createCard(v, i)));

  } catch (err) {
    console.error("Render error:", err);
  }
}

// ---- Card factory ----
function createCard(video, index) {
  const card = document.createElement('div');
  card.className = 'video-card';
  if (selectedVideoIds.has(video.videoId)) card.classList.add('selected');
  card.dataset.id = video.videoId;
  card.style.animationDelay = `${Math.min(index * 0.04, 0.4)}s`;

  const date = new Date(video.dateSaved).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const durHtml = video.durationFormatted ? `<span class="duration-badge">${escapeHtml(video.durationFormatted)}</span>` : '';
  const checked = selectedVideoIds.has(video.videoId) ? 'checked' : '';

  card.innerHTML = `
    <input type="checkbox" class="card-checkbox" value="${video.videoId}" ${checked}>
    <div class="thumbnail-container">
      <img class="thumbnail" loading="lazy" src="${video.thumbnailUrl || ''}"
        onerror="this.onerror=null;this.src='https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg';"
        alt="${escapeHtml(video.title)}"/>
      ${durHtml}
    </div>
    <div class="card-content">
      <h3 class="title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h3>
      <a href="${video.channelUrl || '#'}" class="channel" target="_blank" rel="noopener noreferrer">${escapeHtml(video.channelName)}</a>
      <div class="date-saved">Saved: ${date}</div>
      <button class="delete-btn" title="Remove" aria-label="Remove">×</button>
    </div>`;

  const checkbox = card.querySelector('.card-checkbox');

  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) { selectedVideoIds.add(video.videoId); card.classList.add('selected'); }
    else { selectedVideoIds.delete(video.videoId); card.classList.remove('selected'); }
    updateSelectionBar();
  });

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('channel') || e.target.classList.contains('card-checkbox')) return;
    if (e.target.classList.contains('delete-btn')) {
      deleteSingleVideo(video, card);
    } else if (selectedVideoIds.size > 0) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    } else {
      openSingleVideo(video, card);
    }
  });

  return card;
}

async function deleteSingleVideo(video, cardElement) {
  cardElement.classList.add('card-exit');
  const snapshot = [...allVideos];
  setTimeout(async () => {
    const newVideos = allVideos.filter(v => v.videoId !== video.videoId);
    await chrome.storage.local.set({ savedVideos: newVideos });
  }, 300);
  showUndoToast(`"${video.title.substring(0, 40)}..." removed`, async () => {
    await chrome.storage.local.set({ savedVideos: snapshot });
  });
}

async function openSingleVideo(video, cardElement) {
  chrome.tabs.create({ url: video.url });
  cardElement.classList.add('card-exit');
  setTimeout(async () => {
    const newVideos = allVideos.filter(v => v.videoId !== video.videoId);
    await chrome.storage.local.set({ savedVideos: newVideos });
  }, 300);
}

// ---- Utilities ----
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe.toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
