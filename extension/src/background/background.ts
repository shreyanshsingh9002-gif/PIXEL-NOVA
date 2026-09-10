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

// Helper to normalize any input into a valid navigable web URL
function normalizeWebUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "spotify") return "https://open.spotify.com";
  if (lower === "youtube") return "https://www.youtube.com";
  if (lower === "amazon") return "https://www.amazon.in";
  if (lower === "google") return "https://www.google.com";
  if (lower === "flipkart") return "https://www.flipkart.com";
  if (lower === "netflix") return "https://www.netflix.com";
  if (lower === "github") return "https://www.github.com";
  if (lower === "reddit") return "https://www.reddit.com";
  if (lower === "wikipedia") return "https://www.wikipedia.org";
  if (lower === "cricbuzz") return "https://www.cricbuzz.com";
  if (lower === "twitter" || lower === "x") return "https://x.com";
  if (lower === "linkedin") return "https://www.linkedin.com";

  // If looks like a domain name (e.g. youtube.com, amazon.in, news.ycombinator.com/item?id=1)
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  // Otherwise default to Google Web Search
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

// Wait for a tab to finish loading (status === 'complete') with timeout safeguard
function waitForTabReady(tabId: number, timeoutMs = 12000): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: any = null;

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve(true);
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(false); // Proceed even if timeout fires
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

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

  // Universal Navigation: Open any website in the world
  if (message?.type === "NAVIGATE_TAB") {
    (async () => {
      try {
        const targetUrl = normalizeWebUrl(message.url || "https://www.google.com");
        let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
          tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        }

        let targetTabId: number;
        const currentTab = tabs?.[0];

        // If active tab is on chrome:// or edge://, create a fresh web tab
        if (!currentTab?.id || currentTab.url?.startsWith("chrome://") || currentTab.url?.startsWith("edge://")) {
          const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
          targetTabId = newTab.id!;
        } else {
          targetTabId = currentTab.id;
          await chrome.tabs.update(targetTabId, { url: targetUrl });
        }

        // Wait for page to reach complete state
        await waitForTabReady(targetTabId, 14000);

        // Allow DOM to stabilize
        await new Promise((r) => setTimeout(r, 800));

        // Inject content.js if missing
        try {
          await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            files: ["content.js"]
          });
        } catch (injectErr) {
          // Content script might already be present
        }

        sendResponse({ success: true, url: targetUrl, tabId: targetTabId });
      } catch (err: any) {
        console.error("Navigation error:", err);
        sendResponse({ success: false, error: err.message || "Failed to navigate" });
      }
    })();
    return true;
  }

  return false;
});