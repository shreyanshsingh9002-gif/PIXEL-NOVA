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
  if (lower === "gaana") return "https://gaana.com";
  if (lower === "jiosaavn") return "https://www.jiosaavn.com";
  if (lower === "wynk") return "https://wynk.in/music";
  if (lower === "soundcloud") return "https://soundcloud.com";
  if (lower === "amazon") return "https://www.amazon.in";
  if (lower === "flipkart") return "https://www.flipkart.com";
  if (lower === "myntra") return "https://www.myntra.com";
  if (lower === "meesho") return "https://www.meesho.com";
  if (lower === "nykaa") return "https://www.nykaa.com";
  if (lower === "ajio") return "https://www.ajio.com";
  if (lower === "google") return "https://www.google.com";
  if (lower === "target") return "https://www.target.com";
  if (lower === "walmart") return "https://www.walmart.com";
  if (lower === "bestbuy") return "https://www.bestbuy.com";
  if (lower === "ebay") return "https://www.ebay.com";
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

  // Universal fallback for single brand words (e.g. "gaana", "myntra", "zepto") without spaces
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed) && trimmed.length >= 3) {
    return `https://www.${lower}.com`;
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

  // Real Hardware-Level Click via Chrome DevTools Protocol (CDP Input.dispatchMouseEvent)
  // Generates genuine isTrusted: true click events bypassing browser autoplay & React shields
  if (message?.type === "DISPATCH_REAL_CLICK" || message?.action === "DISPATCH_REAL_CLICK") {
    (async () => {
      let tabId = message.tabId || _sender.tab?.id;
      if (!tabId) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tabs[0]?.id;
      }
      if (!tabId) {
        sendResponse({ success: false, error: "No active tab for real click" });
        return;
      }

      const target = { tabId };
      try {
        try {
          await chrome.debugger.attach(target, "1.3");
        } catch (attachErr: any) {
          if (!attachErr?.message?.includes("Already attached")) {
            throw attachErr;
          }
        }

        const x = Math.round(message.x);
        const y = Math.round(message.y);

        // 1. Move mouse to target coordinates
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y
        });

        // 2. Press left mouse button
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          buttons: 1,
          clickCount: 1
        });

        // Realistic click press duration
        await new Promise((r) => setTimeout(r, 60));

        // 3. Release left mouse button -> Produces genuine isTrusted: true click!
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1
        });

        sendResponse({ success: true, isTrusted: true, x, y });
      } catch (err: any) {
        console.error("CDP Real Click error:", err);
        sendResponse({ success: false, error: err?.message || String(err) });
      } finally {
        try {
          await chrome.debugger.detach(target);
        } catch (detachErr) {}
      }
    })();
    return true;
  }

  return false;
});