import { scrapeYouTubeTab } from '../content/scraper.js';

// ---- State & Storage Setup ----

async function updateActiveTabsCache() {
  const tabs = await chrome.tabs.query({ url: [
    "*://*.youtube.com/watch?v=*",
    "*://*.youtube.com/shorts/*",
    "*://*.youtube.com/live/*"
  ] });
  const map = {};
  for(const t of tabs) map[t.id] = { url: t.url, title: t.title };
  
  if (chrome.storage && chrome.storage.session) {
    await chrome.storage.session.set({ activeYoutubeTabs: map });
  }
}

// Initial hydration
updateActiveTabsCache();

// Keep tracker updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    if (tab.url && tab.url.includes('youtube.com/')) {
      updateActiveTabsCache();
    }
  }
});

// Auto-Collapse tracking logic with Queue to prevent races at termination
let savingPromise = Promise.resolve();

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) {
    const { settings = {} } = await chrome.storage.local.get("settings");
    if (!settings.autoCollapse) return;

    if (chrome.storage && chrome.storage.session) {
      const { activeYoutubeTabs = {} } = await chrome.storage.session.get("activeYoutubeTabs");
      const tabData = activeYoutubeTabs[tabId];
      
      if (tabData) {
        // Enforce linear asynchronous saving sequence
        savingPromise = savingPromise.then(async () => {
          const videoObj = urlToVideoData(tabData.url, tabData.title);
          if (!videoObj) return;

          const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
          const alreadyExists = savedVideos.some(v => v.videoId === videoObj.videoId);
          if (!alreadyExists) {
            savedVideos.unshift(videoObj);
            await chrome.storage.local.set({ savedVideos });
          }
        });
      }
    }
  } else {
    // Standard tab close, just update cache
    updateActiveTabsCache();
  }
});

// ---- Manual Collapse (Clicking Extension Icon) ----

async function handleCollapse() {
  const tabs = await chrome.tabs.query({ url: [
    "*://*.youtube.com/watch?v=*",
    "*://*.youtube.com/shorts/*",
    "*://*.youtube.com/live/*"
  ] });
  
  if (tabs.length > 0) {
    const newVideos = [];

    for (const tab of tabs) {
      try {
        if (tab.discarded || tab.status === "unloaded") {
          const videoObj = urlToVideoData(tab.url, tab.title);
          if (videoObj) {
            videoObj.metadataSource = 'discarded';
            newVideos.push(videoObj);
          }
        } else {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapeYouTubeTab,
          });
          const metadata = results[0]?.result;
          if (metadata) newVideos.push(metadata);
        }
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error(`Failed to process tab ${tab.id}:`, e);
      }
    }

    const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
    const savedIds = new Set(savedVideos.map(v => v.videoId));
    const trulyNewVideos = newVideos.filter(v => !savedIds.has(v.videoId));
    const updatedVideos = [...trulyNewVideos, ...savedVideos];

    await chrome.storage.local.set({ savedVideos: updatedVideos });

    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "FoldTube",
      message: `Folded ${tabs.length} YouTube tab${tabs.length === 1 ? '' : 's'}!`,
      silent: true
    });

    // Automatically try to enrich the missing discarded tabs
    runEnrichment();

  } else {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "FoldTube",
      message: "No YouTube tabs found.",
      silent: true
    });
  }

  const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html");
  const dashboardTabs = await chrome.tabs.query({ url: dashboardUrl });
  if (dashboardTabs.length > 0) {
    const existingTab = dashboardTabs[0];
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
}

chrome.action.onClicked.addListener(handleCollapse);

// ---- Utility functions ----

function urlToVideoData(urlStr, rawTitle) {
  let videoId = null;
  let videoType = 'video';
  try {
    const urlObj = new URL(urlStr);
    if (urlObj.pathname.startsWith('/shorts/')) {
      const parts = urlObj.pathname.split('/');
      videoId = parts[parts.length - 1];
      videoType = 'short';
    } else if (urlObj.pathname.startsWith('/live/')) {
      const parts = urlObj.pathname.split('/');
      videoId = parts[parts.length - 1];
    } else {
      videoId = urlObj.searchParams.get('v');
    }
  } catch(e) {}
  if (!videoId) return null;

  let safeTitle = rawTitle || 'Unknown Title';
  if (safeTitle.endsWith(' - YouTube')) safeTitle = safeTitle.substring(0, safeTitle.length - 10);

  return {
    videoId,
    videoType,
    url: urlStr,
    title: safeTitle,
    channelName: "Unknown Channel",
    channelUrl: null,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    durationSeconds: 0,
    durationFormatted: "",
    description: "",
    dateSaved: new Date().toISOString(),
    metadataSource: 'auto-collapsed' // Overwritten if discarded manual click
  };
}

// ---- Startup Reconciliation & Enrichment ----

chrome.runtime.onStartup.addListener(async () => {
  await reconcileTabs();
  await runEnrichment();
  await updateActiveTabsCache();
});

async function reconcileTabs() {
  const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
  if (savedVideos.length === 0) return;

  const physicalTabs = await chrome.tabs.query({ url: ["*://*.youtube.com/watch?v=*", "*://*.youtube.com/shorts/*", "*://*.youtube.com/live/*"] });
  if (physicalTabs.length === 0) return;

  // Extract video IDs from restored tabs for robust matching regardless of
  // extra query params (timestamps, playlist refs, etc.) that may differ.
  const physicalVideoIds = new Set(physicalTabs.map(t => {
    try {
      const u = new URL(t.url);
      if (u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/')) {
        const parts = u.pathname.split('/');
        return parts[parts.length - 1] || null;
      }
      return u.searchParams.get('v');
    } catch { return null; }
  }).filter(Boolean));

  const cleansedVideos = savedVideos.filter(video => {
    // If it was auto-collapsed, and the browser cleanly restored it, delete it.
    if (video.metadataSource === "auto-collapsed" && physicalVideoIds.has(video.videoId)) {
      return false; // Remove!
    }
    return true; // Keep!
  });

  if (cleansedVideos.length !== savedVideos.length) {
    await chrome.storage.local.set({ savedVideos: cleansedVideos });
    console.log(`Reconciled and destroyed ${savedVideos.length - cleansedVideos.length} duplicated restored tabs.`);
  }
}

async function runEnrichment() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (!settings.apiKey) return;

  let { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
  
  const needsEnrichment = savedVideos.filter(v => 
    v.durationSeconds === 0 || 
    v.channelName === "Unknown Channel" || 
    v.metadataSource === "auto-collapsed" || 
    v.metadataSource === "discarded"
  );
  
  if (needsEnrichment.length === 0) return;

  const apiKey = settings.apiKey;
  const idsToProcess = [...new Set(needsEnrichment.map(v => v.videoId))];
  let isModified = false;

  for (let i = 0; i < idsToProcess.length; i += 50) {
    const batch = idsToProcess.slice(i, i + 50);
    try {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${batch.join(',')}&key=${apiKey}`);
      const data = await resp.json();
      
      if (data.error) {
        console.error("YouTube API Errored:", data.error.message);
        await chrome.storage.local.set({ apiError: true });
        return; // Abort enrichment loop to avoid spamming bad keys
      } else {
        await chrome.storage.local.set({ apiError: false }); // Clear if success
      }
      
      if (data.items) {
        data.items.forEach(item => {
          // Update all references in savedVideos (in case of dupes)
          savedVideos.forEach(video => {
            if (video.videoId === item.id) {
              video.title = item.snippet.title;
              video.channelName = item.snippet.channelTitle;
              
              // Map Duration ISO 8601
              const pt = item.contentDetails.duration;
              const match = pt.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
              if (match) {
                const h = parseInt(match[1] || 0, 10);
                const m = parseInt(match[2] || 0, 10);
                const s = parseInt(match[3] || 0, 10);
                video.durationSeconds = (h * 3600) + (m * 60) + s;
                
                const hStr = h > 0 ? `${h}:` : '';
                const mStr = h > 0 ? m.toString().padStart(2, '0') : m.toString();
                const sStr = s.toString().padStart(2, '0');
                video.durationFormatted = `${hStr}${mStr}:${sStr}`;
              }
              video.metadataSource = 'api-enriched';
              isModified = true;
            }
          });
        });
      }
    } catch(e) {
      console.error("API Enrichment fetch failed.", e);
    }
  }

  if (isModified) {
    await chrome.storage.local.set({ savedVideos });
  }
}

// Receive message from Dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "runEnrichment") {
    runEnrichment();
  }
});
