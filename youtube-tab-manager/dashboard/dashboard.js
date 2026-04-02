document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  await loadVideos();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.savedVideos) {
      renderVideos(changes.savedVideos.newValue);
    }
  });
}

async function loadVideos() {
  const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
  renderVideos(savedVideos);
}

function renderVideos(videos) {
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
    videoCount.textContent = '0 items';
    return;
  }

  emptyState.classList.add('hidden');
  videoCount.textContent = `${videos.length} item${videos.length === 1 ? '' : 's'}`;
  
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
  card.dataset.id = video.videoId;
  card.dataset.url = video.url;
  // Stagger animation
  card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;

  const formattedDate = new Date(video.dateSaved).toLocaleDateString(undefined, { 
    year: 'numeric', month: 'short', day: 'numeric' 
  });

  const durationHtml = video.durationFormatted ? `<span class="duration-badge">${escapeHtml(video.durationFormatted)}</span>` : '';

  card.innerHTML = `
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

  // Click handlers
  card.addEventListener('click', (e) => {
    // If clicking channel link, do nothing else
    if (e.target.classList.contains('channel')) return;
    
    if (e.target.classList.contains('delete-btn')) {
      deleteVideo(video.videoId, card);
      e.stopPropagation();
    } else {
      openVideo(video.videoId, video.url, card);
    }
  });

  return card;
}

async function removeVideoFromStorage(videoId) {
  const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
  const newVideos = savedVideos.filter(v => v.videoId !== videoId);
  await chrome.storage.local.set({ savedVideos: newVideos });
}

async function deleteVideo(videoId, cardElement) {
  cardElement.classList.add('card-exit');
  // Wait for animation
  setTimeout(async () => {
    await removeVideoFromStorage(videoId);
  }, 300);
}

async function openVideo(videoId, url, cardElement) {
  chrome.tabs.create({ url });
  cardElement.classList.add('card-exit');
  setTimeout(async () => {
    await removeVideoFromStorage(videoId);
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
