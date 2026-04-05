export function scrapeYouTubeTab() {
  const isShort = window.location.pathname.startsWith('/shorts/');
  const isLive = window.location.pathname.startsWith('/live/');
  let videoId = null;
  let videoType = 'video';

  if (isShort) {
    const parts = window.location.pathname.split('/');
    videoId = parts[parts.length - 1];
    videoType = 'short';
  } else if (isLive) {
    const parts = window.location.pathname.split('/');
    videoId = parts[parts.length - 1];
  } else {
    const videoIdMatch = window.location.search.match(/[?&]v=([^&]+)/);
    videoId = videoIdMatch ? videoIdMatch[1] : null;
  }

  if (!videoId) return null;

  // Title extraction with fallbacks
  let title = '';
  const titleVideoEl = document.querySelector('h1.ytd-video-primary-info-renderer');
  const titleShortEl = document.querySelector('h2.title.ytd-reel-player-header-renderer');
  
  if (titleVideoEl && titleVideoEl.textContent.trim()) {
    title = titleVideoEl.textContent.trim();
  } else if (titleShortEl && titleShortEl.textContent.trim()) {
    title = titleShortEl.textContent.trim();
  } else if (document.title) {
    title = document.title;
  }

  if (title.endsWith(' - YouTube')) {
    title = title.substring(0, title.length - 10);
  }
  if (!title) title = 'Unknown Title';

  // Channel extraction with fallbacks
  let channelName = '';
  let channelUrl = null;

  // ytd-video-owner-renderer is used on /watch, ytd-reel-player-header-renderer on /shorts
  const channelVideoEl = document.querySelector('ytd-video-owner-renderer ytd-channel-name a') || document.querySelector('#channel-name a');
  const channelShortEl = document.querySelector('ytd-reel-player-header-renderer[is-active] ytd-channel-name a') || document.querySelector('ytd-reel-player-header-renderer ytd-channel-name a');
  
  const finalChannelEl = isShort ? (channelShortEl || channelVideoEl) : (channelVideoEl || channelShortEl);

  if (finalChannelEl) {
    channelName = finalChannelEl.textContent.trim();
    channelUrl = finalChannelEl.href;
  } else {
    const authorLink = document.querySelector('link[itemprop="name"]');
    if (authorLink) channelName = authorLink.getAttribute('content');
    
    const urlLink = document.querySelector('link[itemprop="url"]');
    if (urlLink) channelUrl = urlLink.getAttribute('href');
  }

  if (!channelName) channelName = 'Unknown Channel';

  let durationSeconds = 0;
  let durationFormatted = '';

  if (!isShort) {
    // Prefer the meta tag — it always reflects the real video duration,
    // even when an ad is playing (the player UI shows the ad length instead).
    const metaDuration = document.querySelector('meta[itemprop="duration"]');
    if (metaDuration) {
      const pt = metaDuration.getAttribute('content') || '';
      const match = pt.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (match) {
        const h = parseInt(match[1] || 0, 10);
        const m = parseInt(match[2] || 0, 10);
        const s = parseInt(match[3] || 0, 10);
        durationSeconds = (h * 3600) + (m * 60) + s;

        const hStr = h > 0 ? `${h}:` : '';
        const mStr = h > 0 ? m.toString().padStart(2, '0') : m.toString();
        const sStr = s.toString().padStart(2, '0');
        durationFormatted = `${hStr}${mStr}:${sStr}`;
      }
    }

    // Fallback: read the player UI (may be wrong during ads, but better than nothing)
    if (!durationSeconds) {
      const durationEl = document.querySelector('span.ytp-time-duration');
      durationFormatted = durationEl ? durationEl.textContent.trim() : '';

      if (durationFormatted) {
        const parts = durationFormatted.split(':').map(Number);
        if (parts.length === 3) {
          durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          durationSeconds = parts[0] * 60 + parts[1];
        }
      }
    }
  }

  const descEl = document.querySelector('#description-inline-expander') || document.querySelector('ytd-text-inline-expander');
  const description = descEl ? descEl.textContent.trim() : '';

  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  return {
    videoId,
    videoType,
    url: window.location.href,
    title,
    channelName,
    channelUrl,
    thumbnailUrl,
    durationSeconds,
    durationFormatted,
    description,
    dateSaved: new Date().toISOString(),
    metadataSource: 'scrape'
  };
}
