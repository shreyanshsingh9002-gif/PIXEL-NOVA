chrome.runtime.onInstalled.addListener(() => {
  console.log("🌌 PIXEL NOVA Background Service Worker Initialized");
});

// Open Side Panel on action icon click
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error("Failed to open side panel:", err);
  }
});

// Handle messages from SidePanel or Content Script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_SCREENSHOT") {
    chrome.tabs.captureVisibleTab(
      { format: "png" },
      (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError?.message || "Failed to capture tab"
          });
        } else {
          sendResponse({
            success: true,
            dataUrl
          });
        }
      }
    );
    return true; // Keep channel open for async response
  }
  return false;
});