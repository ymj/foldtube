let allVideos = [];
let selectedVideoIds = new Set();
let searchQuery = "";
let currentSort = "date-desc";
let currentDurationFilter = null;

let appSettings = {
  autoCollapse: false,
  apiKey: ''
};

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  if (settings) {
    appSettings = { ...appSettings, ...settings };
  }
  document.getElementById('auto-collapse-toggle').checked = appSettings.autoCollapse;
  document.getElementById('api-key-input').value = appSettings.apiKey;
  
  if (appSettings.apiKey) {
    document.getElementById('btn-clear-api').classList.remove('hidden');
  } else {
    document.getElementById('btn-clear-api').classList.add('hidden');
  }
}

async function saveSettings() {
  await chrome.storage.local.set({ settings: appSettings });
  if (appSettings.apiKey) {
    document.getElementById('btn-clear-api').classList.remove('hidden');
  } else {
    document.getElementById('btn-clear-api').classList.add('hidden');
  }
}

async function init() {
  await loadSettings();
  bindControls();
  await loadVideos();

  // Load API error state initially
  chrome.storage.local.get("apiError").then(({apiError}) => {
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

function bindControls() {
  const settingsModal = document.getElementById('settings-modal');
  
  document.getElementById('btn-settings').addEventListener('click', () => { settingsModal.showModal(); });
  document.getElementById('btn-close-settings').addEventListener('click', () => { settingsModal.close(); });
  document.getElementById('btn-dismiss-banner').addEventListener('click', async () => {
    document.getElementById('api-error-banner').classList.add('hidden');
    await chrome.storage.local.set({ apiError: false });
  });

  document.getElementById('auto-collapse-toggle').addEventListener('change', async (e) => {
    appSettings.autoCollapse = e.target.checked;
    await saveSettings();
  });

  document.getElementById('btn-save-api').addEventListener('click', async () => {
    appSettings.apiKey = document.getElementById('api-key-input').value.trim();
    await saveSettings();
    document.getElementById('btn-save-api').textContent = "Saved!";
    setTimeout(() => { document.getElementById('btn-save-api').textContent = "Save Key"; }, 2000);
    // Clear old errors and trigger enrichment
    await chrome.storage.local.set({ apiError: false });
    chrome.runtime.sendMessage({ action: "runEnrichment" });
  });

  document.getElementById('btn-clear-api').addEventListener('click', async () => {
    appSettings.apiKey = '';
    document.getElementById('api-key-input').value = '';
    await saveSettings();
    await chrome.storage.local.set({ apiError: false });
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const dataStr = JSON.stringify(allVideos, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `foldtube_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-export-html').addEventListener('click', () => {
    let htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FoldTube Backup</title>
    <style>body{font-family:sans-serif; background:#0f0f0f; color:#fff; padding:2rem; max-width:800px; margin:0 auto;} a{color:#3ea6ff; text-decoration:none;} a:hover{text-decoration:underline;} li{margin:10px 0;} span{color:#aaa; font-size:0.9em;}</style>
    </head><body><h1>FoldTube Tabs Backup</h1><ul>`;
    
    allVideos.forEach(v => {
      htmlContent += `<li><a href="${v.url}" target="_blank">${escapeHtml(v.title)}</a> <span>— ${escapeHtml(v.channelName)} (${v.durationFormatted || 'live'})</span></li>`;
    });
    
    htmlContent += `</ul></body></html>`;
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `foldtube_bookmarks_${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-import-trigger').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const importedData = JSON.parse(evt.target.result);
        if (!Array.isArray(importedData)) throw new Error("Invalid format");
        
        const savedIds = new Set(allVideos.map(v => v.videoId));
        const newItems = importedData.filter(v => v.videoId && !savedIds.has(v.videoId));
        
        const merged = [...newItems, ...allVideos];
        await chrome.storage.local.set({ savedVideos: merged });
        alert(`Successfully imported ${newItems.length} new videos!`);
      } catch (err) {
        alert("Failed to parse the JSON file.");
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    processAndRender();
  });

  document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    processAndRender();
  });

  const durationFilters = document.getElementById('duration-filters');
  durationFilters.addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-pill')) {
      const isAllPill = e.target.dataset.all === "true";
      const isActive = e.target.classList.contains('active');
      
      document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
      
      if (isAllPill || isActive) {
        document.querySelector('.filter-pill[data-all="true"]').classList.add('active');
        currentDurationFilter = null;
      } else {
        e.target.classList.add('active');
        currentDurationFilter = {
          min: parseInt(e.target.dataset.min, 10),
          max: parseInt(e.target.dataset.max, 10)
        };
      }
      processAndRender();
    }
  });

  document.getElementById('btn-select-all').addEventListener('click', () => {
    const visibleVideos = getProcessedVideos();
    visibleVideos.forEach(v => selectedVideoIds.add(v.videoId));
    updateSelectionBar();
    document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = true);
    document.querySelectorAll('.video-card').forEach(card => card.classList.add('selected'));
  });

  document.getElementById('btn-deselect-all').addEventListener('click', () => {
    selectedVideoIds.clear();
    updateSelectionBar();
    document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
    document.querySelectorAll('.video-card').forEach(card => card.classList.remove('selected'));
  });

  document.getElementById('btn-open-selected').addEventListener('click', async () => {
    if (selectedVideoIds.size === 0) return;
    if (selectedVideoIds.size > 10) {
      if (!confirm(`This will open ${selectedVideoIds.size} tabs. Continue?`)) return;
    }
    const ids = Array.from(selectedVideoIds);
    const urlsToOpen = allVideos.filter(v => ids.includes(v.videoId)).map(v => v.url);
    urlsToOpen.forEach(url => chrome.tabs.create({ url, active: false }));
    
    const newVideos = allVideos.filter(v => !selectedVideoIds.has(v.videoId));
    selectedVideoIds.clear();
    updateSelectionBar();
    await chrome.storage.local.set({ savedVideos: newVideos });
  });

  document.getElementById('btn-delete-selected').addEventListener('click', async () => {
    if (selectedVideoIds.size === 0) return;
    if (selectedVideoIds.size > 1 && !confirm(`Delete ${selectedVideoIds.size} selected videos?`)) return;
    
    const newVideos = allVideos.filter(v => !selectedVideoIds.has(v.videoId));
    selectedVideoIds.clear();
    updateSelectionBar();
    await chrome.storage.local.set({ savedVideos: newVideos });
  });
}

function updateSelectionBar() {
  const selectionBar = document.getElementById('selection-bar');
  const selectionCountObj = document.getElementById('selection-count');
  
  if (selectedVideoIds.size > 0) {
    selectionBar.classList.remove('hidden');
    selectionCountObj.textContent = `${selectedVideoIds.size} selected`;
  } else {
    selectionBar.classList.add('hidden');
  }
}

async function loadVideos() {
  const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
  allVideos = savedVideos;
  processAndRender();
}

function getProcessedVideos() {
  let processed = [...allVideos];

  if (searchQuery) {
    processed = processed.filter(v => 
      (v.title && v.title.toLowerCase().includes(searchQuery)) ||
      (v.channelName && v.channelName.toLowerCase().includes(searchQuery)) ||
      (v.description && v.description.toLowerCase().includes(searchQuery))
    );
  }

  if (currentDurationFilter) {
    processed = processed.filter(v => {
      const ds = v.durationSeconds || 0;
      return ds >= currentDurationFilter.min && ds < currentDurationFilter.max;
    });
  }

  processed.sort((a, b) => {
    switch (currentSort) {
      case 'date-desc': return new Date(b.dateSaved) - new Date(a.dateSaved);
      case 'date-asc': return new Date(a.dateSaved) - new Date(b.dateSaved);
      case 'dur-asc': return (a.durationSeconds || 0) - (b.durationSeconds || 0);
      case 'dur-desc': return (b.durationSeconds || 0) - (a.durationSeconds || 0);
      case 'chan-asc': return (a.channelName || '').localeCompare(b.channelName || '');
      case 'chan-desc': return (b.channelName || '').localeCompare(a.channelName || '');
      case 'title-asc': return (a.title || '').localeCompare(b.title || '');
      default: return 0;
    }
  });

  return processed;
}

function processAndRender() {
  const videos = getProcessedVideos();
  updateSelectionBar();

  const videoGrid = document.getElementById('video-grid');
  const shortsGrid = document.getElementById('shorts-grid');
  const videosSection = document.getElementById('videos-section');
  const shortsSection = document.getElementById('shorts-section');
  const emptyState = document.getElementById('empty-state');
  const videoCount = document.querySelector('.video-count');

  if (!videos || videos.length === 0) {
    videoGrid.innerHTML = '';
    shortsGrid.innerHTML = '';
    videosSection.classList.add('hidden');
    shortsSection.classList.add('hidden');
    emptyState.classList.remove('hidden');
    
    if (allVideos.length > 0) {
      emptyState.innerHTML = '<p>No matching videos found.</p>';
      videoCount.textContent = `Showing 0 of ${allVideos.length} items`;
    } else {
      emptyState.innerHTML = '<p>No saved videos yet. Click the extension icon to collect your open YouTube tabs.</p>';
      videoCount.textContent = '0 items';
    }
    return;
  }

  emptyState.classList.add('hidden');
  
  if (allVideos.length !== videos.length) {
    videoCount.textContent = `Showing ${videos.length} of ${allVideos.length} items`;
  } else {
    videoCount.textContent = `${videos.length} item${videos.length === 1 ? '' : 's'}`;
  }
  
  videoGrid.innerHTML = '';
  shortsGrid.innerHTML = '';

  const standardVideos = videos.filter(v => v.videoType !== 'short');
  const shorts = videos.filter(v => v.videoType === 'short');

  if (standardVideos.length > 0) {
    videosSection.classList.remove('hidden');
    standardVideos.forEach((video, index) => {
      videoGrid.appendChild(createCard(video, index));
    });
  } else {
    videosSection.classList.add('hidden');
  }

  if (shorts.length > 0) {
    shortsSection.classList.remove('hidden');
    shorts.forEach((video, index) => {
      shortsGrid.appendChild(createCard(video, index));
    });
  } else {
    shortsSection.classList.add('hidden');
  }
}

function createCard(video, index) {
  const card = document.createElement('div');
  card.className = 'video-card';
  if (selectedVideoIds.has(video.videoId)) {
    card.classList.add('selected');
  }
  card.dataset.id = video.videoId;
  card.dataset.url = video.url;
  card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;

  const formattedDate = new Date(video.dateSaved).toLocaleDateString(undefined, { 
    year: 'numeric', month: 'short', day: 'numeric' 
  });

  const durationHtml = video.durationFormatted ? `<span class="duration-badge">${escapeHtml(video.durationFormatted)}</span>` : '';
  const isChecked = selectedVideoIds.has(video.videoId) ? 'checked' : '';

  card.innerHTML = `
    <input type="checkbox" class="card-checkbox" value="${video.videoId}" ${isChecked}>
    <div class="thumbnail-container">
      <img class="thumbnail" src="${video.thumbnailUrl || 'https://via.placeholder.com/320x180?text=No+Thumbnail'}" onerror="this.onerror=null; this.src='https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg';" alt="Thumbnail" />
      ${durationHtml}
    </div>
    <div class="card-content">
      <h3 class="title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h3>
      <a href="${video.channelUrl || '#'}" class="channel" target="_blank" rel="noopener noreferrer">${escapeHtml(video.channelName)}</a>
      <div class="date-saved">Saved: ${formattedDate}</div>
      <button class="delete-btn" title="Remove" aria-label="Remove">×</button>
    </div>
  `;

  const checkbox = card.querySelector('.card-checkbox');
  
  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      selectedVideoIds.add(video.videoId);
      card.classList.add('selected');
    } else {
      selectedVideoIds.delete(video.videoId);
      card.classList.remove('selected');
    }
    updateSelectionBar();
  });

  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('channel')) return;
    if (e.target.classList.contains('card-checkbox')) return; 

    if (e.target.classList.contains('delete-btn')) {
      deleteSingleVideo(video.videoId, card);
      e.stopPropagation();
    } else {
      if (selectedVideoIds.size > 0) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      } else {
        openSingleVideo(video.videoId, video.url, card);
      }
    }
  });

  return card;
}

async function deleteSingleVideo(videoId, cardElement) {
  cardElement.classList.add('card-exit');
  setTimeout(async () => {
    const newVideos = allVideos.filter(v => v.videoId !== videoId);
    await chrome.storage.local.set({ savedVideos: newVideos });
  }, 300);
}

async function openSingleVideo(videoId, url, cardElement) {
  chrome.tabs.create({ url });
  cardElement.classList.add('card-exit');
  setTimeout(async () => {
    const newVideos = allVideos.filter(v => v.videoId !== videoId);
    await chrome.storage.local.set({ savedVideos: newVideos });
  }, 300);
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}
