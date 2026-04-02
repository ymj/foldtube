let allVideos = [];
let selectedVideoIds = new Set();
let searchQuery = "";
let currentSort = "date-desc";
let currentDurationFilter = null; // { min: number, max: number }

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  bindControls();
  await loadVideos();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.savedVideos) {
      allVideos = changes.savedVideos.newValue || [];
      // To prevent deselecting if they delete one, clean up selected:
      const currentIds = new Set(allVideos.map(v => v.videoId));
      for (const id of selectedVideoIds) {
        if (!currentIds.has(id)) selectedVideoIds.delete(id);
      }
      processAndRender();
    }
  });
}

function bindControls() {
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

  // Bulk Actions
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
    // Find urls
    const urlsToOpen = allVideos.filter(v => ids.includes(v.videoId)).map(v => v.url);
    urlsToOpen.forEach(url => chrome.tabs.create({ url, active: false }));
    
    // Delete from storage
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

  // 1. Search
  if (searchQuery) {
    processed = processed.filter(v => 
      (v.title && v.title.toLowerCase().includes(searchQuery)) ||
      (v.channelName && v.channelName.toLowerCase().includes(searchQuery)) ||
      (v.description && v.description.toLowerCase().includes(searchQuery))
    );
  }

  // 2. Filter Duration
  if (currentDurationFilter) {
    processed = processed.filter(v => {
      const ds = v.durationSeconds || 0;
      return ds >= currentDurationFilter.min && ds < currentDurationFilter.max;
    });
  }

  // 3. Sort
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
