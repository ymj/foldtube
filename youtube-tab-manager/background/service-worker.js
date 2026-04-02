import { scrapeYouTubeTab } from '../content/scraper.js';

async function handleCollapse() {
  const tabs = await chrome.tabs.query({ url: [
    "*://*.youtube.com/watch?v=*",
    "*://*.youtube.com/shorts/*"
  ] });
  
  if (tabs.length > 0) {
    const newVideos = [];

    for (const tab of tabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeYouTubeTab,
        });
        
        const metadata = results[0]?.result;
        if (metadata) {
          newVideos.push(metadata);
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
  } else {
    console.log("No YouTube tabs found.");
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
