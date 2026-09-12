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

// Quick-Launch Hotkey (Alt+N) handler
if (typeof chrome.commands?.onCommand !== "undefined") {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "toggle-nova-voice") {
      try {
        let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
          tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        }
        const activeTab = tabs?.[0];
        const windowId = activeTab?.windowId;

        // Set storage latch so if sidepanel was closed, it begins listening on mount
        await chrome.storage.local.set({ autoStartVoice: Date.now() });

        if (windowId && typeof chrome.sidePanel?.open === "function") {
          try {
            await chrome.sidePanel.open({ windowId });
          } catch (e) {
            if (activeTab?.id) {
              try {
                await (chrome.sidePanel as any).open({ tabId: activeTab.id });
              } catch (e2) {}
            }
          }
        }

        // Dispatch immediate voice activation event to sidepanel
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "ACTIVATE_VOICE_LISTENER" }).catch(() => {});
        }, 350);
      } catch (err) {
        console.error("Error handling toggle-nova-voice hotkey:", err);
      }
    }
  });
}

const FORMAL_PLATFORMS: Record<string, string> = {
  // Travel & Indian Railways
  irctc: "https://www.irctc.co.in/nget/",
  railway: "https://www.irctc.co.in/nget/",
  railways: "https://www.irctc.co.in/nget/",
  makemytrip: "https://www.makemytrip.com",
  mmt: "https://www.makemytrip.com",
  goibibo: "https://www.goibibo.com",
  redbus: "https://www.redbus.in",
  ixigo: "https://www.ixigo.com",
  easemytrip: "https://www.easemytrip.com",
  uber: "https://m.uber.com",
  ola: "https://www.olacabs.com",

  // Indian Government & Public Utilities
  digilocker: "https://www.digilocker.gov.in",
  uidai: "https://myaadhaar.uidai.gov.in",
  aadhaar: "https://myaadhaar.uidai.gov.in",
  aadhar: "https://myaadhaar.uidai.gov.in",
  incometax: "https://www.incometax.gov.in/iec/foportal/",
  itr: "https://www.incometax.gov.in/iec/foportal/",
  parivahan: "https://parivahan.gov.in",
  vahan: "https://parivahan.gov.in",
  sarathi: "https://parivahan.gov.in",
  passport: "https://www.passportindia.gov.in",
  epfo: "https://www.epfindia.gov.in",
  pf: "https://www.epfindia.gov.in",
  cowin: "https://www.cowin.gov.in",
  upsc: "https://upsc.gov.in",
  indiapost: "https://www.indiapost.gov.in",
  postoffice: "https://www.indiapost.gov.in",
  voters: "https://voters.eci.gov.in",
  nvsp: "https://voters.eci.gov.in",

  // Education, Coding & College Portals
  kiet: "https://www.kiet.edu",
  aktu: "https://aktu.ac.in",
  leetcode: "https://leetcode.com",
  geeksforgeeks: "https://www.geeksforgeeks.org",
  gfg: "https://www.geeksforgeeks.org",
  hackerrank: "https://www.hackerrank.com",
  codeforces: "https://codeforces.com",
  codechef: "https://www.codechef.com",
  coursera: "https://www.coursera.org",
  udemy: "https://www.udemy.com",
  swayam: "https://swayam.gov.in",
  nptel: "https://nptel.ac.in",
  stackoverflow: "https://stackoverflow.com",
  w3schools: "https://www.w3schools.com",
  arxiv: "https://arxiv.org",

  // Food, Grocery & Quick Commerce
  zomato: "https://www.zomato.com",
  swiggy: "https://www.swiggy.com",
  blinkit: "https://www.blinkit.com",
  zepto: "https://www.zepto.com",
  bigbasket: "https://www.bigbasket.com",
  dominos: "https://pizzaonline.dominos.co.in",
  mcdonalds: "https://mcdelivery.co.in",

  // Entertainment, Movies & Sports
  bookmyshow: "https://in.bookmyshow.com",
  bms: "https://in.bookmyshow.com",
  hotstar: "https://www.hotstar.com",
  primevideo: "https://www.primevideo.com",
  jiocinema: "https://www.jiocinema.com",
  sonyliv: "https://www.sonyliv.com",
  zee5: "https://www.zee5.com",
  cricbuzz: "https://www.cricbuzz.com",
  espn: "https://www.espncricinfo.com",
  netflix: "https://www.netflix.com",
  spotify: "https://open.spotify.com",
  youtube: "https://www.youtube.com",
  gaana: "https://gaana.com",
  jiosaavn: "https://www.jiosaavn.com",
  wynk: "https://wynk.in/music",
  soundcloud: "https://soundcloud.com",
  applemusic: "https://music.apple.com",

  // Shopping
  amazon: "https://www.amazon.in",
  flipkart: "https://www.flipkart.com",
  myntra: "https://www.myntra.com",
  meesho: "https://www.meesho.com",
  nykaa: "https://www.nykaa.com",
  ajio: "https://www.ajio.com",
  target: "https://www.target.com",
  walmart: "https://www.walmart.com",
  bestbuy: "https://www.bestbuy.com",
  ebay: "https://www.ebay.com",

  // Banking, Finance & Fintech
  sbi: "https://www.onlinesbi.sbi",
  onlinesbi: "https://www.onlinesbi.sbi",
  hdfc: "https://netbanking.hdfcbank.com",
  icici: "https://www.icicibank.com",
  axis: "https://www.axisbank.com",
  kotak: "https://www.kotak.com",
  zerodha: "https://kite.zerodha.com",
  groww: "https://groww.in",
  paytm: "https://paytm.com",
  phonepe: "https://www.phonepe.com",

  // Social, Productivity & AI
  google: "https://www.google.com",
  wikipedia: "https://www.wikipedia.org",
  github: "https://www.github.com",
  reddit: "https://www.reddit.com",
  twitter: "https://x.com",
  x: "https://x.com",
  linkedin: "https://www.linkedin.com",
  instagram: "https://www.instagram.com",
  insta: "https://www.instagram.com",
  facebook: "https://www.facebook.com",
  fb: "https://www.facebook.com",
  whatsapp: "https://web.whatsapp.com",
  telegram: "https://web.telegram.org",
  gmail: "https://mail.google.com",
  chatgpt: "https://chatgpt.com",
  openai: "https://chatgpt.com",
  gemini: "https://gemini.google.com",
  claude: "https://claude.ai",
  canva: "https://www.canva.com",
  notion: "https://www.notion.so",
  figma: "https://www.figma.com",
  drive: "https://drive.google.com"
};

// Helper to normalize any input into a valid navigable web URL
function normalizeWebUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (FORMAL_PLATFORMS[lower]) {
    return FORMAL_PLATFORMS[lower];
  }

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

  // Safe Browser History Navigation: Go Back / Go Forward
  if (message?.type === "HISTORY_NAVIGATE") {
    (async () => {
      try {
        let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
          tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        }
        const targetTabId = message.tabId || tabs?.[0]?.id;
        if (!targetTabId) {
          sendResponse({ success: false, direction: message.direction, error: "No active browser tab found" });
          return;
        }

        const direction = message.direction === "forward" ? "forward" : "back";
        if (direction === "back") {
          await chrome.tabs.goBack(targetTabId);
        } else {
          await chrome.tabs.goForward(targetTabId);
        }

        // Wait for page to reach complete state
        await waitForTabReady(targetTabId, 10000);

        // Allow DOM to stabilize
        await new Promise((r) => setTimeout(r, 800));

        // Inject content.js if missing on the restored page
        try {
          await chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            files: ["content.js"]
          });
        } catch (injectErr) {
          // Content script might already be active
        }

        const updatedTab = await chrome.tabs.get(targetTabId);
        sendResponse({ success: true, direction, url: updatedTab.url, tabId: targetTabId });
      } catch (err: any) {
        console.warn("History navigation notice:", err);
        sendResponse({
          success: false,
          direction: message.direction,
          error: err.message?.includes("Cannot navigate") || err.message?.includes("history")
            ? `At the ${message.direction === "forward" ? "latest page (cannot go forward further)" : "beginning of tab history (cannot go back further)"}.`
            : (err.message || "Failed to navigate history")
        });
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
        const clickCount = message.clickCount || 1;

        // 1. Move mouse to target coordinates
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y
        });

        for (let c = 1; c <= clickCount; c++) {
          // 2. Press left mouse button
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x,
            y,
            button: "left",
            buttons: 1,
            clickCount: c
          });

          // Realistic click press duration
          await new Promise((r) => setTimeout(r, 50));

          // 3. Release left mouse button -> Produces genuine isTrusted: true click!
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x,
            y,
            button: "left",
            buttons: 0,
            clickCount: c
          });

          if (c < clickCount) {
            await new Promise((r) => setTimeout(r, 60));
          }
        }

        sendResponse({ success: true, isTrusted: true, x, y, clickCount });
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