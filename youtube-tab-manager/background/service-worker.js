import { scrapeYouTubeTab } from '../content/scraper.js';

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
          let videoId = null;
          let videoType = 'video';
          
          try {
            const urlObj = new URL(tab.url);
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

          if (videoId) {
            let safeTitle = tab.title || 'Unknown Title';
            if (safeTitle.endsWith(' - YouTube')) {
              safeTitle = safeTitle.substring(0, safeTitle.length - 10);
            }

            newVideos.push({
              videoId,
              videoType,
              url: tab.url,
              title: safeTitle,
              channelName: "Unknown Channel",
              channelUrl: null,
              thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
              durationSeconds: 0,
              durationFormatted: "",
              description: "",
              dateSaved: new Date().toISOString(),
              metadataSource: 'discarded'
            });
          }
        } else {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapeYouTubeTab,
          });
          
          const metadata = results[0]?.result;
          if (metadata) {
            newVideos.push(metadata);
          }
        }
        
        // Close the tab
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error(`Failed to process tab ${tab.id}:`, e);
      }
    }

    // Save to storage
    const { savedVideos = [] } = await chrome.storage.local.get("savedVideos");
    
    const savedIds = new Set(savedVideos.map(v => v.videoId));
    const trulyNewVideos = newVideos.filter(v => !savedIds.has(v.videoId));
    
    const updatedVideos = [...trulyNewVideos, ...savedVideos];

    await chrome.storage.local.set({ savedVideos: updatedVideos });

    chrome.notifications.create({
      type: "basic",
      iconUrl: "../icons/icon128.png",
      title: "FoldTube",
      message: `Folded ${tabs.length} YouTube tab${tabs.length === 1 ? '' : 's'}!`,
      silent: true
    });
  } else {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "../icons/icon128.png",
      title: "FoldTube",
      message: "No YouTube tabs found.",
      silent: true
    });
  }

  // Open the dashboard tab or focus if already open
  const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html");
  const dashboardTabs = await chrome.tabs.query({ url: dashboardUrl });
  
  if (dashboardTabs.length > 0) {
    await chrome.tabs.update(dashboardTabs[0].id, { active: true });
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
}

chrome.action.onClicked.addListener(handleCollapse);

// Optional: For handling keyboard shortcut explicitly if _execute_action fails
chrome.commands.onCommand.addListener((command) => {
  if (command === "_execute_action") {
    handleCollapse();
  }
});
