import {
  InteractiveElement,
  PageInfo,
  BoundingBox,
  AgentAction,
  UserVaultProfile,
  DeepNavResult
} from "../shared/types";
import { detectPIIInDOM } from "../privacy/piiDetector";

console.log("🌌 PIXEL NOVA Content Script Initialized");

let currentHighlightOverlay: HTMLDivElement | null = null;

function getUniqueSelector(el: Element): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }
  const name = el.getAttribute("name");
  if (name) {
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;
  }
  const role = el.getAttribute("role");
  if (role) {
    return `${el.tagName.toLowerCase()}[role="${CSS.escape(role)}"]`;
  }

  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.className && typeof current.className === "string") {
      const firstClass = current.className.trim().split(/\s+/)[0];
      if (firstClass && !firstClass.includes(":") && !firstClass.includes("/")) {
        selector += `.${CSS.escape(firstClass)}`;
      }
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current?.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    path.unshift(selector);
    current = parent;
  }
  return path.join(" > ");
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el.offsetParent && el.tagName !== "BODY" && el.tagName !== "HTML") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(el);
  if (
    style.visibility === "hidden" ||
    style.display === "none" ||
    parseFloat(style.opacity) === 0
  ) {
    return false;
  }

  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

function getPageInformation(): PageInfo {
  const title = document.title || "Untitled Page";
  const url = window.location.href;
  const text = (document.body?.innerText || "").trim();

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [role="searchbox"], [role="combobox"], [role="switch"], [role="option"], [onclick], [data-action], [tabindex]:not([tabindex="-1"])'
    )
  );

  const allDivsAndSpans = Array.from(
    document.querySelectorAll<HTMLElement>("div, span, li, summary, label")
  );
  for (const el of allDivsAndSpans) {
    if (candidates.length >= 80) break;
    if (el.children.length === 0 || (el.children.length === 1 && el.querySelector("svg, img"))) {
      const style = window.getComputedStyle(el);
      if (style.cursor === "pointer" && !candidates.includes(el)) {
        candidates.push(el);
      }
    }
  }

  const interactiveElements: InteractiveElement[] = [];
  let idx = 0;

  for (const el of candidates) {
    if (!isElementVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    const boundingBox: BoundingBox = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      left: Math.round(rect.left)
    };

    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    const name = el.getAttribute("name");
    const id = el.id || "";
    const ariaLabel = el.getAttribute("aria-label") || el.getAttribute("title");
    const placeholder = el.getAttribute("placeholder");

    let visibleText = (el.innerText || el.textContent || "").trim();
    if (tag === "input" || tag === "textarea") {
      const inputVal = (el as HTMLInputElement).value;
      if (inputVal && type !== "password") {
        visibleText = inputVal;
      }
    }
    if (!visibleText) {
      const img = el.querySelector("img");
      if (img?.alt) visibleText = img.alt;
      const svg = el.querySelector("svg");
      if (svg?.getAttribute("aria-label")) visibleText = svg.getAttribute("aria-label") || "";
    }

    const valToCheck = (el as HTMLInputElement).value || visibleText;
    const isValuePII = valToCheck && (
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(valToCheck) ||
      /(?:\+91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}/.test(valToCheck) ||
      /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(valToCheck) ||
      /\b[2-9]\d{3}[-\s]?\d{4}[-\s]?\d{4}\b/.test(valToCheck) ||
      /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/.test(valToCheck)
    );

    const isSensitive =
      type === "password" ||
      type === "email" ||
      type === "tel" ||
      (name && /pass|card|cvv|cvc|expir|aadhaar|pan|pin|otp|address|city|state|zip|district|postal|email|mail|phone|tel|mobile|name|recipient|contact/i.test(name)) ||
      (id && /pass|card|cvv|cvc|expir|aadhaar|pan|pin|otp|address|city|state|zip|district|postal|email|mail|phone|tel|mobile|name|recipient|contact/i.test(id)) ||
      (placeholder && /pass|card|cvv|cvc|expir|aadhaar|pan|pin|otp|address|city|state|zip|district|postal|email|mail|phone|tel|mobile|name|recipient|contact/i.test(placeholder)) ||
      (ariaLabel && /pass|card|cvv|cvc|expir|aadhaar|pan|pin|otp|address|city|state|zip|district|postal|email|mail|phone|tel|mobile|name|recipient|contact/i.test(ariaLabel)) ||
      !!isValuePII;

    interactiveElements.push({
      index: idx++,
      tag,
      text: visibleText,
      ariaLabel,
      placeholder,
      type,
      id,
      name,
      selector: getUniqueSelector(el),
      boundingBox,
      isVisible: true,
      isSensitive: !!isSensitive,
      value: (el as HTMLInputElement).value
    });

    if (interactiveElements.length >= 60) break;
  }

  // Detect sensitive PII entities directly within the live DOM context with pixel coordinates
  const { entities } = detectPIIInDOM(document, interactiveElements);

  return {
    title,
    url,
    text,
    interactiveElements,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio || 1
    },
    detectedEntities: entities
  };
}

function highlightElementByIndex(index: number) {
  clearHighlightOverlay();
  const pageInfo = getPageInformation();
  const target = pageInfo.interactiveElements.find((e) => e.index === index);
  if (!target) return;

  const overlay = document.createElement("div");
  overlay.id = "pixel-nova-hud-overlay";
  overlay.style.position = "fixed";
  overlay.style.left = `${target.boundingBox.left}px`;
  overlay.style.top = `${target.boundingBox.top}px`;
  overlay.style.width = `${target.boundingBox.width}px`;
  overlay.style.height = `${target.boundingBox.height}px`;
  overlay.style.border = "2px solid #38bdf8";
  overlay.style.boxShadow = "0 0 16px rgba(56, 189, 248, 0.85)";
  overlay.style.borderRadius = "4px";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "2147483647";
  overlay.style.transition = "all 0.15s ease";

  const label = document.createElement("span");
  label.innerText = `🌌 [Target #${index}: ${target.tag}]`;
  label.style.position = "absolute";
  label.style.top = "-22px";
  label.style.left = "0";
  label.style.background = "#0f172a";
  label.style.color = "#38bdf8";
  label.style.fontSize = "11px";
  label.style.fontWeight = "bold";
  label.style.padding = "2px 6px";
  label.style.borderRadius = "3px";
  label.style.border = "1px solid #38bdf8";

  overlay.appendChild(label);
  document.body.appendChild(overlay);
  currentHighlightOverlay = overlay;
}

function clearHighlightOverlay() {
  if (currentHighlightOverlay) {
    currentHighlightOverlay.remove();
    currentHighlightOverlay = null;
  }
}

function findTargetElementSmart(rawTerm: string): HTMLElement | null {
  if (!rawTerm || !rawTerm.trim()) return null;

  const lower = rawTerm.toLowerCase().trim();
  if (lower === "cart" || lower === "go to cart" || lower === "open cart") {
    const cartEl = document.querySelector<HTMLElement>(
      "#nav-cart, #btn-nav-cart, a[href*='/cart'], a[href*='cart'], button[id*='cart']"
    );
    if (cartEl) return cartEl;
  }

  // Clean the search term
  let cleanTerm = rawTerm
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\b(?:click|tap|press|select|open|go\s+to)\s+(?:on\s+)?/gi, "")
    .replace(/\b(?:button|btn|link|tab|icon|card|page|waale|wale|kro|karo|pe)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleanTerm) cleanTerm = rawTerm.trim().toLowerCase();

  // Keyword tokens for multi-token overlap matching
  const tokens = cleanTerm
    .split(/[\s,_\-—/|]+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter((w) => w.length >= 2 && !["the", "and", "for", "with", "this", "that"].includes(w));

  // Collect candidate elements: interactive elements first
  const interactiveCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a, input[type='button'], input[type='submit'], [role='button'], [role='tab'], [role='link'], [role='menuitem'], [onclick], .btn, select, label, summary, [tabindex]"
    )
  );

  const allTextCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "h1, h2, h3, h4, h5, h6, strong, b, span, p, div, li, td, tr, [data-testid], [data-component-type]"
    )
  );

  function getElSearchableStrings(el: HTMLElement) {
    const text = (el.innerText || el.textContent || "").trim().toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
    const title = (el.getAttribute("title") || "").trim().toLowerCase();
    const val = ((el as HTMLInputElement).value || "").trim().toLowerCase();
    const id = (el.id || "").trim().toLowerCase();
    const name = (el.getAttribute("name") || "").trim().toLowerCase();
    const href = (el.getAttribute("href") || "").trim().toLowerCase();
    return { text, aria, title, val, id, name, href, combined: `${text} ${aria} ${title} ${val} ${id} ${name}` };
  }

  // Pass 1: Exact match on interactive elements
  for (const el of interactiveCandidates) {
    if (el.offsetParent === null && !el.getClientRects().length) continue;
    const { text, aria, title, val } = getElSearchableStrings(el);
    if (text === cleanTerm || aria === cleanTerm || title === cleanTerm || val === cleanTerm) {
      return el;
    }
  }

  // Pass 2: Substring match on interactive elements
  for (const el of interactiveCandidates) {
    if (el.offsetParent === null && !el.getClientRects().length) continue;
    const { text, aria, title, val } = getElSearchableStrings(el);
    if (
      (text && (text.includes(cleanTerm) || cleanTerm.includes(text))) ||
      (aria && (aria.includes(cleanTerm) || cleanTerm.includes(aria))) ||
      (title && title.includes(cleanTerm)) ||
      (val && val.includes(cleanTerm))
    ) {
      return el;
    }
  }

  // Pass 3: Multi-token overlap match on interactive elements
  if (tokens.length > 0) {
    let bestEl: HTMLElement | null = null;
    let highestScore = 0;

    for (const el of interactiveCandidates) {
      if (el.offsetParent === null && !el.getClientRects().length) continue;
      const { combined } = getElSearchableStrings(el);
      let matchCount = 0;
      for (const t of tokens) {
        if (combined.includes(t)) matchCount++;
      }
      if (matchCount > 0) {
        const score = (matchCount / tokens.length) * 100 - (combined.length > 150 ? 20 : 0);
        if (score > highestScore) {
          highestScore = score;
          bestEl = el;
        }
      }
    }

    if (bestEl && highestScore >= 35) {
      return bestEl;
    }
  }

  // Pass 4: Match on visible text elements, then resolve to closest interactive ancestor
  for (const el of allTextCandidates) {
    if (el.children.length > 6) continue;
    if (el.offsetParent === null && !el.getClientRects().length) continue;
    const { text, aria } = getElSearchableStrings(el);
    if (!text && !aria) continue;

    const matched =
      text === cleanTerm ||
      aria === cleanTerm ||
      (text.length < 120 && text.includes(cleanTerm)) ||
      (tokens.length >= 2 && tokens.every((t) => text.includes(t)));

    if (matched) {
      const interactiveParent = el.closest<HTMLElement>(
        "button, a, [role='button'], [role='tab'], [role='link'], [onclick], .btn, label, li, tr"
      );
      return interactiveParent || el;
    }
  }

  // Pass 5: ID / Name / Href match
  for (const el of interactiveCandidates) {
    const { id, name, href } = getElSearchableStrings(el);
    if (tokens.some((t) => (id && id.includes(t)) || (name && name.includes(t)) || (href && href.includes(t)))) {
      return el;
    }
  }

  return null;
}

// Universal Search Bar Resolver: Finds, reveals, and focuses the search input on ANY website
async function findAndFocusSearchInput(): Promise<HTMLInputElement | HTMLTextAreaElement | null> {
  const searchInputSelectors = [
    // 1. Specialized test IDs & roles (Spotify, Twitter/X, Discord, Slack, etc.)
    "input[data-testid='search-input']",
    "input[data-testid='SearchBox_Search_Input']",
    "input[data-testid*='search' i]",
    "[role='searchbox']",
    "input[type='search']",

    // 2. High-traffic platform search inputs
    "#twotabsearchtextbox",                         // Amazon Desktop
    "#nav-search-keywords",                         // Amazon Mobile
    "input[name='field-keywords']",                 // Amazon General
    "input#search",                                 // YouTube
    "input.ytd-searchbox",                          // YouTube
    "input[name='search_query']",                   // YouTube
    "textarea[name='q']",                           // Google Search (modern textarea)
    "input[name='q']",                              // Google Search / General q
    "#searchInput",                                 // Wikipedia
    "input[name='search']",                         // Wikipedia / Standard HTML
    "input.desktop-searchBar",                      // Myntra
    "input[placeholder*='Search for Products' i]",  // Flipkart
    "input[title*='Search for Products' i]",        // Flipkart
    "input[name='query-builder-test']",             // GitHub Command Bar
    "input.header-search-input",                    // GitHub
    "input[placeholder*='Search GitHub' i]",        // GitHub

    // 3. Music, Streaming & Media players (Spotify, SoundCloud, Apple Music, Netflix)
    "input[placeholder*='What do you want to play' i]",
    "input[placeholder*='What do you want to listen' i]",
    "input[placeholder*='Artists, songs' i]",
    "input[placeholder*='Search artists' i]",
    "input[placeholder*='Search songs' i]",
    "input[placeholder*='Search music' i]",
    "input.searchInput",

    // 4. Universal semantic attribute matching
    "input[aria-label*='search' i]",
    "textarea[aria-label*='search' i]",
    "input[placeholder*='search' i]",
    "textarea[placeholder*='search' i]",
    "input[placeholder*='find' i]",
    "input[id*='search' i]",
    "input[name*='search' i]",
    "input[class*='search' i]",
    "input[name='s']",                              // WordPress standard search
    "input[name='k']",                              // Asian / Japanese e-commerce
    "input[name='keyword']",
    "input[name='query']",

    // 5. Form containers with search semantics
    "form[role='search'] input:not([type='hidden']):not([type='submit'])",
    "form[action*='search'] input:not([type='hidden']):not([type='submit'])",
    "[role='search'] input:not([type='hidden']):not([type='submit'])",
    "header input[type='text']",
    "nav input[type='text']"
  ];

  // Pass 1: Direct lookup for any already visible search input on screen
  for (const selector of searchInputSelectors) {
    try {
      const candidates = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector));
      for (const el of candidates) {
        if (isElementVisible(el)) {
          return el;
        }
      }
    } catch (e) {}
  }

  // Pass 2: Search might be collapsed behind a search toggle button or nav link (e.g. Spotify Home page or mobile menu)
  const searchOpenerSelectors = [
    "a[href*='/search']",
    "a[aria-label*='Search' i]",
    "button[data-testid='search-tab']",
    "button[aria-label*='Search' i]",
    "#search-button-narrow",
    "button.searchTab",
    "button.search-toggle",
    "button.search-button",
    "button[title*='search' i]",
    "[role='button'][aria-label*='search' i]",
    "a[title*='search' i]",
    ".header-search-button",
    "button[class*='search' i]"
  ];

  for (const selector of searchOpenerSelectors) {
    try {
      const opener = document.querySelector<HTMLElement>(selector);
      if (opener && isElementVisible(opener)) {
        opener.focus();
        opener.click();
        // Wait 400ms for search input to be mounted into the DOM
        await new Promise((r) => setTimeout(r, 450));

        // Re-check for newly mounted search input
        for (const inputSel of searchInputSelectors) {
          const candidates = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(inputSel));
          for (const el of candidates) {
            if (isElementVisible(el)) {
              return el;
            }
          }
        }
        break;
      }
    } catch (e) {}
  }

  // Pass 3: Fallback to the first prominent text input in header/nav/body
  const fallback = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "header input:not([type='hidden']), nav input:not([type='hidden']), input[type='text'], textarea"
  );
  if (fallback && isElementVisible(fallback)) {
    return fallback;
  }

  return null;
}

interface ProductQueryInfo {
  cleanQuery: string;
  words: string[];
  discriminators: string[];
}

function parseProductQueryTokens(query: string): ProductQueryInfo {
  const clean = (query || "")
    .toLowerCase()
    .replace(/^(?:search(?:\s+for)?|find|buy|order|open|get|add\s*(?:it)?\s*to\s*cart)\s*/i, "")
    .replace(/\s+(?:in|on|at)\s+[a-z0-9.-]+$/i, "")
    .replace(/\s+and\s+add\s+to\s+cart.*$/i, "")
    .replace(/^(?:open\s+product:\s*)/i, "")
    .trim();

  // Keep all semantic keywords including laptop, phone, headphones, shoes, etc.
  // Only exclude grammatical stop-words
  const stopWords = ["for", "the", "and", "a", "an", "to", "in", "on", "of", "with", "at", "by", "from"];
  const words = clean
    .split(/\s+/)
    .filter((w) => (w.length >= 2 || /\d/.test(w)) && !stopWords.includes(w));

  const discriminators: string[] = [];
  for (const w of words) {
    if (/\d/.test(w) || ["pro", "max", "plus", "ultra", "air", "mini", "lite"].includes(w)) {
      discriminators.push(w);
    }
  }

  return { cleanQuery: clean, words, discriminators };
}

const ECOMMERCE_ACCESSORY_WORDS = [
  "case", "cover", "sleeve", "skin", "pouch", "bag", "protector", "tempered glass",
  "adapter", "cable", "charger", "cord", "hub", "dock", "stand", "holder", "mount",
  "strap", "band", "shell", "guard", "decal", "sticker", "cleaning kit", "replacement",
  "stylus", "pen"
];

function scoreProductCardCandidate(
  title: string,
  queryInfo: ProductQueryInfo,
  isSponsored: boolean,
  hasAddToCartBtn: boolean
): { score: number; isMatch: boolean; reason: string } {
  const t = title.toLowerCase();

  // 1. Filter out accessories unless query explicitly requested an accessory
  const isAccessory = ECOMMERCE_ACCESSORY_WORDS.some((acc) => new RegExp(`\\b${acc}\\b`, "i").test(t));
  const wantsAccessory = queryInfo.words.some((w) => ECOMMERCE_ACCESSORY_WORDS.includes(w));
  if (isAccessory && !wantsAccessory) {
    return { score: 0, isMatch: false, reason: "Filtered accessory (case/stand/cover)" };
  }

  // 2. Strict Discriminator Matching (e.g. "m4" MUST be present if requested)
  for (const disc of queryInfo.discriminators) {
    const discReg = new RegExp(`\\b${disc}\\b`, "i");
    if (!discReg.test(t)) {
      return { score: 0, isMatch: false, reason: `Missing mandatory model discriminator '${disc}'` };
    }
  }

  // 3. Prevent chip confusion (e.g. M4 requested vs M5, M3, M2, M1)
  const mSeries = queryInfo.cleanQuery.match(/\bm([1-9])\b/i);
  if (mSeries) {
    const targetM = `m${mSeries[1]}`;
    const chipsInTitle = t.match(/\bm([1-9])\b/gi);
    if (chipsInTitle) {
      const hasTargetChip = chipsInTitle.some((c) => c.toLowerCase() === targetM);
      if (!hasTargetChip) {
        return { score: 0, isMatch: false, reason: `Conflicting chip detected (${chipsInTitle.join(", ")}) vs ${targetM}` };
      }
    }
  }

  // 4. Overlap scoring
  let matchedCount = 0;
  let score = 0;
  for (const w of queryInfo.words) {
    if (new RegExp(`\\b${w}\\b`, "i").test(t)) {
      matchedCount++;
      score += queryInfo.discriminators.includes(w) ? 30 : 15;
    }
  }

  if (queryInfo.words.length > 0 && matchedCount / queryInfo.words.length < 0.5) {
    return { score: 0, isMatch: false, reason: "Insufficient keyword match" };
  }

  // 5. Refurbished / Renewed penalty (prefer brand-new unless requested)
  const isRenewed = /\b(?:refurbished|renewed|pre-owned|used)\b/i.test(t);
  const wantsRenewed = /\b(?:refurbished|renewed|pre-owned|used)\b/i.test(queryInfo.cleanQuery);
  if (isRenewed && !wantsRenewed) {
    score -= 35;
  }

  // 6. Base vs Pro/Max tier preference
  if (!queryInfo.discriminators.includes("max") && /\bmax\b/i.test(t)) {
    score -= 10;
  }
  if (!queryInfo.discriminators.includes("pro") && /\bpro\b/i.test(t)) {
    score -= 5;
  }

  // 7. Sponsored penalty
  if (isSponsored) score -= 20;
  if (hasAddToCartBtn) score += 6;

  return { score, isMatch: score > 0, reason: `Verified Match (Score: ${score})` };
}

async function clickAddToCartOnProductPage(): Promise<{ success: boolean; productFound?: boolean; productTitle?: string; result?: string; error?: string }> {
  const cartSelectors = [
    "#add-to-cart-button",
    "input[name='submit.add-to-cart']",
    "#submit\\.add-to-cart",
    "#submit\\.add-to-cart-announce",
    "button[name='submit.add-to-cart']",
    "#add-to-cart-button-bb",
    "#addToCart input",
    "#addToCart_feature_div input",
    "[data-action='add-to-cart']",
    ".btn-cart",
    "#buy-now-button",
    "button._2KpZ6l._2U9uOA._3v1-ww",
    "button._2KpZ6l._2U9uOA.ihZ85k._3AWRsL"
  ];

  let cartBtn: HTMLElement | null = null;

  // Pass 1: Try finding immediately
  for (const sel of cartSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
      cartBtn = el;
      break;
    }
  }

  // Pass 2: Smooth scroll down to bring Buy Box / Specs into view
  if (!cartBtn) {
    window.scrollBy({ top: 550, behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 800));

    for (const sel of cartSelectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        cartBtn = el;
        break;
      }
    }
  }

  // Pass 3: Button text fallback
  if (!cartBtn) {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("button, input[type='button'], input[type='submit'], a.a-button-text"));
    cartBtn = buttons.find((b) => /\badd\s+to\s+(?:cart|bag|basket)\b/i.test(b.innerText || b.getAttribute("value") || "")) || null;
  }

  if (!cartBtn) {
    return {
      success: false,
      productFound: false,
      error: "Could not locate 'Add to Cart' button on product page."
    };
  }

  cartBtn.scrollIntoView({ behavior: "smooth", block: "center" });
  await new Promise((r) => setTimeout(r, 600));

  cartBtn.click();
  await new Promise((r) => setTimeout(r, 1400));

  // Dismiss any AppleCare / warranty upsell popup ("No thanks")
  const noThanksBtn = document.querySelector<HTMLElement>(
    "#attachSiNoCoverage, input[name='submit.attach-si-no-coverage'], #attach-sidesheet-view-cart-button, button[aria-label='Close'], #attach-close_sideSheet-link, .a-button-close"
  );
  if (noThanksBtn && (noThanksBtn.offsetParent !== null || noThanksBtn.getClientRects().length > 0)) {
    noThanksBtn.click();
    await new Promise((r) => setTimeout(r, 600));
  }

  return {
    success: true,
    productFound: true,
    productTitle: document.title,
    result: "Successfully scrolled to Buy Box and clicked 'Add to Cart' on product page!"
  };
}

async function findAndAddVerifiedProduct(
  query: string,
  checkFirstViewOnly: boolean
): Promise<{ success: boolean; productFound: boolean; productTitle?: string; navigatingToProduct?: boolean; productUrl?: string; addedDirectly?: boolean; result?: string; error?: string }> {
  // A. Check if current page is ALREADY a specific product page (e.g. /dp/ on Amazon)
  const onProductPage =
    window.location.href.includes("/dp/") ||
    window.location.href.includes("/gp/product/") ||
    document.querySelector("#add-to-cart-button, #buyNow") !== null;

  if (onProductPage) {
    return await clickAddToCartOnProductPage();
  }

  // B. Search results page: locate all product result cards
  const queryInfo = parseProductQueryTokens(query);
  const cardElements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-component-type='s-search-result'], .s-result-item[data-asin]:not([data-asin='']), div[data-id], div._1AtVbE, .product-card, .product-item"
    )
  ).filter((el) => {
    // Avoid carousel / ad-banner widgets on Amazon
    return el.closest(".s-widget-container:has(.a-carousel), [data-component-type='s-ads-widget'], [data-component-type='sp-sponsored-carousel'], .ad-holder") === null;
  });

  if (cardElements.length === 0) {
    return {
      success: false,
      productFound: false,
      error: "No product cards detected on the current page."
    };
  }

  interface ScoredCard {
    cardEl: HTMLElement;
    titleEl: HTMLElement | null;
    title: string;
    score: number;
    isInFirstView: boolean;
    hasAddToCart: boolean;
    addToCartBtn: HTMLElement | null;
  }

  const scoredCards: ScoredCard[] = [];

  for (const card of cardElements) {
    const titleEl = card.querySelector<HTMLElement>(
      "h2 a, .s-title-instructions-style a, a.a-link-normal.s-underline-text, .KzDlHZ, a.wjcEIp, a.CG2Akx, .product-title a, h3 a"
    );
    const title = (titleEl?.textContent || card.querySelector("h2, h3")?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 5) continue;

    const isSponsored =
      card.querySelector(".puis-sponsored-label-text, .s-sponsored-label-text, [data-component-type='sp-sponsored-result']") !== null ||
      /\bsponsored\b/i.test(card.innerText || "");

    const addToCartBtn = card.querySelector<HTMLElement>(
      "[data-component-type='s-add-to-cart-button'] button, button[name='submit.add-to-cart'], button.a-button-text[name*='add-to-cart'], [data-action='add-to-cart'], .s-add-to-cart-button button"
    );
    const hasAddToCart = addToCartBtn !== null && isElementVisible(addToCartBtn);

    const rect = card.getBoundingClientRect();
    // In first view: top of card is within active viewport window
    const isInFirstView = rect.top < window.innerHeight + 60 && rect.bottom > 40;

    if (checkFirstViewOnly && !isInFirstView) {
      continue;
    }

    const { isMatch, score } = scoreProductCardCandidate(title, queryInfo, isSponsored, hasAddToCart);
    if (isMatch && score > 0) {
      scoredCards.push({
        cardEl: card,
        titleEl,
        title,
        score,
        isInFirstView,
        hasAddToCart,
        addToCartBtn
      });
    }
  }

  if (scoredCards.length === 0) {
    return {
      success: false,
      productFound: false,
      error: checkFirstViewOnly
        ? `No genuine match for "${queryInfo.cleanQuery}" visible in the first view.`
        : `Could not find verified match for "${queryInfo.cleanQuery}" after scanning visible cards.`
    };
  }

  // Sort best match to top
  scoredCards.sort((a, b) => b.score - a.score);
  const best = scoredCards[0];

  // Scroll the verified card into center view
  best.cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
  await new Promise((r) => setTimeout(r, 600));

  // Option 1: Click the verified card's inline Add to Cart button if present
  if (best.addToCartBtn && isElementVisible(best.addToCartBtn)) {
    best.addToCartBtn.click();
    await new Promise((r) => setTimeout(r, 1200));
    return {
      success: true,
      productFound: true,
      productTitle: best.title,
      addedDirectly: true,
      result: `Successfully added verified product "${best.title}" to cart!`
    };
  }

  // Option 2: Navigate to product page directly in the SAME tab
  const productHref = (best.titleEl as HTMLAnchorElement)?.href;
  if (productHref) {
    window.location.href = productHref;
    return {
      success: true,
      productFound: true,
      productTitle: best.title,
      navigatingToProduct: true,
      productUrl: productHref,
      result: `Opening verified product "${best.title}"...`
    };
  }

  if (best.titleEl) {
    best.titleEl.click();
    return {
      success: true,
      productFound: true,
      productTitle: best.title,
      navigatingToProduct: true,
      result: `Clicked verified product "${best.title}".`
    };
  }

  return {
    success: false,
    productFound: false,
    error: `Located "${best.title}" but could not trigger navigation or add-to-cart.`
  };
}

async function executeAgentAction(
  action: AgentAction
): Promise<{ success: boolean; result?: string; error?: string; productFound?: boolean; productTitle?: string }> {
  try {
    if (action.action === "scroll") {
      // 1. Scroll directly to targeted text or selector if specified
      if (action.targetText || action.selector) {
        const scrollTarget = action.selector
          ? document.querySelector<HTMLElement>(action.selector)
          : (action.targetText ? findTargetElementSmart(action.targetText) : null);
        if (scrollTarget) {
          scrollTarget.scrollIntoView({ behavior: "smooth", block: "center" });
          return { success: true, result: `Scrolled smoothly to element '${action.targetText || action.selector}'` };
        }
      }
      if (action.direction === "top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return { success: true, result: "Scrolled smoothly to top of page" };
      }
      if (action.direction === "bottom") {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        return { success: true, result: "Scrolled smoothly to bottom of page" };
      }
      const amount = action.amount || 600;
      const top = action.direction === "up" ? -amount : amount;
      window.scrollBy({ top, behavior: "smooth" });
      return { success: true, result: `Scrolled window ${action.direction === "up" ? "up" : "down"} by ${amount}px` };
    }

    if (action.action === "navigate" && (action.url || action.value)) {
      const dest = action.url || action.value!;
      window.location.href = dest;
      return { success: true, result: `Navigating to ${dest}` };
    }

    if (action.action === "wait") {
      const duration = action.amount || 1000;
      await new Promise((r) => setTimeout(r, duration));
      return { success: true, result: `Waited ${duration}ms` };
    }

    if (action.action === "finish") {
      return { success: true, result: "Task marked completed by agent" };
    }

    if (action.action === "find_and_add_product") {
      const query = action.value || action.targetText || "";
      const checkFirstViewOnly = action.amount === 1;
      const isDirectOnProductPage = action.amount === 2;
      if (isDirectOnProductPage) {
        return await clickAddToCartOnProductPage();
      }
      return await findAndAddVerifiedProduct(query, checkFirstViewOnly);
    }

    let targetEl: HTMLElement | null = null;
    if (typeof action.targetIndex === "number") {
      const pageInfo = getPageInformation();
      const elData = pageInfo.interactiveElements.find((e) => e.index === action.targetIndex);
      if (elData?.selector) {
        targetEl = document.querySelector<HTMLElement>(elData.selector);
      }
    }

    if (!targetEl && action.selector) {
      targetEl = document.querySelector<HTMLElement>(action.selector);
    }

    // Target text match (e.g. "click cart", "click track package", "click proceed", "add to cart")
    if (!targetEl && action.targetText) {
      const term = action.targetText.toLowerCase().trim();

      // Priority 1: Direct e-commerce Add to Cart vs Buy Now buttons
      if (term.includes("buy now") || term === "buy now") {
        targetEl = document.querySelector<HTMLElement>(
          "#buy-now-button, input[name='submit.buy-now'], #submit\\.buy-now, #submit\\.buy-now-announce, input[id*='buy-now'], button[id*='buy-now'], [data-action='buy-now'], [aria-label*='Buy Now' i], [title*='Buy Now' i], .a-button-input[value*='Buy Now' i], #buyNow, #buy-now-button-bb, button.btn-buy, #buyNow_feature_div input, #buyNow_feature_div .a-button-inner"
        );
      } else if (term.includes("add to cart") || term.includes("add cart") || term === "add to cart") {
        targetEl = document.querySelector<HTMLElement>(
          "#add-to-cart-button, input[name='submit.add-to-cart'], #submit\\.add-to-cart, #submit\\.add-to-cart-announce, button[name='submit.add-to-cart'], [data-action='add-to-cart'], [aria-label*='Add to Cart' i], [title*='Add to Cart' i], .a-button-input[value*='Add to Cart' i], button.btn-cart, button[id*='add-to-cart'], button[name*='add-to-cart'], form[action*='cart'] button[type='submit'], #submit\\.add-to-cart, #add-to-cart-button-bb, #addToCart, #addToCart_feature_div input, #addToCart_feature_div .a-button-inner"
        );
        // Only click search result button if on a specific single product page or if explicit value passed
        if (!targetEl && action.value) {
          return await findAndAddVerifiedProduct(action.value, false);
        }
      } else if (
        term.startsWith("open product") ||
        term.includes("open product") ||
        term.includes("select product") ||
        (document.querySelectorAll("[data-component-type='s-search-result'], .s-result-item[data-asin]:not([data-asin='']), .product-card").length > 0 &&
          !term.includes("cart") &&
          !term.includes("buy now") &&
          !term.includes("proceed"))
      ) {
        // If the current URL is ALREADY a product page (e.g. /dp/ or /gp/product/), we don't need to open another product!
        if (window.location.href.includes("/dp/") || window.location.href.includes("/gp/product/")) {
          return {
            success: true,
            result: "Already on verified product page."
          };
        }

        // Delegate to high-precision product finder
        const rawClean = term
          .replace(/^(?:open|select)\s+product(?:\s*:)?\s*/i, "")
          .replace(/and\s+add\s+to\s+cart/i, "")
          .trim();
        const verifiedFinderRes = await findAndAddVerifiedProduct(rawClean || action.value || "", false);
        return verifiedFinderRes;
      } else if (
        term.startsWith("play") ||
        term.startsWith("watch") ||
        term.startsWith("listen") ||
        term.startsWith("stream") ||
        window.location.hostname.includes("spotify.com") ||
        window.location.hostname.includes("youtube.com")
      ) {
        const rawSongOrVideoQuery = term
          .replace(/^(?:please\s+)?(?:play|watch|listen(?:\s+to)?|stream|open|click)\s+/i, "")
          .replace(/^(?:the\s+)?(?:song|track|video|music)\s+/i, "")
          .replace(/^["']|["']$/g, "")
          .trim()
          .toLowerCase();

        // 1. YouTube Video / Play Button Resolver
        if (window.location.hostname.includes("youtube.com")) {
          // If already on a watch page, ensure video plays
          const videoEl = document.querySelector<HTMLVideoElement>("video");
          if (videoEl && window.location.pathname.includes("/watch") && (!rawSongOrVideoQuery || rawSongOrVideoQuery.length < 3)) {
            try {
              videoEl.play();
            } catch (e) {}
            targetEl = document.querySelector<HTMLElement>("button.ytp-play-button") || videoEl;
          } else {
            // Find video renderers in search results
            const videoCards = Array.from(
              document.querySelectorAll<HTMLElement>("ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer")
            );
            if (videoCards.length > 0) {
              let matchedTitle: HTMLElement | null = null;
              if (rawSongOrVideoQuery) {
                const queryTokens = rawSongOrVideoQuery.split(/\s+/).filter(Boolean);
                for (const card of videoCards) {
                  const titleEl = card.querySelector<HTMLElement>("#video-title, a#thumbnail, a#video-title-link");
                  const cardText = (card.innerText || card.textContent || "").toLowerCase();
                  if (queryTokens.every((t) => cardText.includes(t)) || queryTokens.some((t) => cardText.includes(t))) {
                    matchedTitle = titleEl || card.querySelector("a") || card;
                    break;
                  }
                }
              }
              if (!matchedTitle && videoCards[0]) {
                matchedTitle = videoCards[0].querySelector<HTMLElement>("#video-title, a#thumbnail, a#video-title-link") || videoCards[0];
              }
              if (matchedTitle) {
                targetEl = matchedTitle;
              }
            }
          }
        }

        // 2. Spotify Track / Play Button Resolver
        if (!targetEl && window.location.hostname.includes("spotify.com")) {
          // Check top result card play button
          const topCardPlayBtn = document.querySelector<HTMLElement>(
            "[data-testid='top-result-card'] button[data-testid='play-button'], [data-testid='top-result-card'] button[aria-label*='Play' i], [data-testid='top-result-card']"
          );
          if (
            topCardPlayBtn &&
            (!rawSongOrVideoQuery || (topCardPlayBtn.innerText || topCardPlayBtn.textContent || "").toLowerCase().includes(rawSongOrVideoQuery))
          ) {
            targetEl = topCardPlayBtn.querySelector("button") || topCardPlayBtn;
          } else {
            // Track list rows
            const trackRows = Array.from(
              document.querySelectorAll<HTMLElement>("[data-testid='tracklist-row'], div[role='row']")
            );
            if (trackRows.length > 0) {
              let matchedRow: HTMLElement | null = null;
              if (rawSongOrVideoQuery) {
                const queryTokens = rawSongOrVideoQuery.split(/\s+/).filter(Boolean);
                for (const row of trackRows) {
                  const rowText = (row.innerText || row.textContent || "").toLowerCase();
                  if (queryTokens.some((t) => rowText.includes(t))) {
                    matchedRow = row;
                    break;
                  }
                }
              }
              if (!matchedRow && trackRows[0]) {
                matchedRow = trackRows[0];
              }
              if (matchedRow) {
                matchedRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
                matchedRow.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
                const rowPlayBtn = matchedRow.querySelector<HTMLElement>("button[data-testid='play-button'], button[aria-label*='Play' i]");
                targetEl = rowPlayBtn || matchedRow;
              }
            } else if (topCardPlayBtn) {
              targetEl = topCardPlayBtn.querySelector("button") || topCardPlayBtn;
            } else {
              targetEl = document.querySelector<HTMLElement>(
                "button[data-testid='play-button'], button[aria-label^='Play'], [data-testid='control-button-playpause']"
              );
            }
          }
        }

        // 3. Generic Audio / Video or Media Player fallback
        if (!targetEl) {
          targetEl = document.querySelector<HTMLElement>(
            "button[aria-label*='play' i], button[title*='play' i], .play-btn, .btn-play, button.play, video, audio"
          );
        }
      } else if (term.includes("cart") || term === "cart") {
        targetEl = document.querySelector<HTMLElement>(
          "#nav-cart, #btn-nav-cart, a[href*='/cart'], a[href*='cart']"
        );
      }

      // If term was 'open product' and no matching card met the threshold, DO NOT fall back to generic buttons or first item!
      const isOpenProductTerm = term.startsWith("open product") || term.includes("open product") || term.includes("select product");

      if (!targetEl && !isOpenProductTerm) {
        targetEl = findTargetElementSmart(action.targetText);
      }
    }

    // Fallback for generic click ONLY if no target text and no target index was provided (e.g. "click here")
    if (!targetEl && action.action === "click" && !action.targetText && typeof action.targetIndex !== "number") {
      // 1. Currently focused element if interactive
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && /button|a|input/i.test(active.tagName)) {
        targetEl = active;
      } else {
        // 2. Most prominent primary CTA on the page
        targetEl = document.querySelector<HTMLElement>(
          "#add-to-cart-button, #btn-proceed-checkout, button[type='submit'], .btn-primary, button.primary, #proceed, #buy-now-button, #btn-track-order-9821, #btn-nav-cart"
        );
      }
    }



    // Search input resolution (Spotify, YouTube, Google, Amazon, Wikipedia, Twitter, etc.)
    if (action.action === "type") {
      if (action.pressEnter || !targetEl) {
        const foundSearchInput = await findAndFocusSearchInput();
        if (foundSearchInput) {
          targetEl = foundSearchInput;
        }
      }
      if (!targetEl) {
        targetEl = document.querySelector<HTMLElement>(
          "#site-search, input[type='search'], input[name*='search' i], input[id*='search' i], input[placeholder*='search' i], input[name='q'], #twotabsearchtextbox, input[type='text'], textarea"
        );
      }
    }

    if (!targetEl) {
      return {
        success: false,
        error: `Could not locate target element (index: ${action.targetIndex}, selector: ${action.selector}, text: ${action.targetText})`
      };
    }

    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    await new Promise((r) => setTimeout(r, 200));

    if (action.action === "click") {
      const isEcommerceBuyOrCart =
        (action.targetText && /buy\s*now|add\s*(?:it\s*)?to\s*cart|add\s*cart/i.test(action.targetText)) ||
        targetEl.matches("#buy-now-button, #add-to-cart-button, [id*='buy-now'], [id*='add-to-cart'], [name*='submit.buy-now'], [name*='submit.add-to-cart'], [id*='submit.buy-now'], [id*='submit.add-to-cart']");

      if (isEcommerceBuyOrCart) {
        // Resolve all related elements in buy-box hierarchy
        const inputEl = (targetEl.tagName.toLowerCase() === "input"
          ? targetEl
          : targetEl.querySelector<HTMLInputElement>("input[type='submit'], input[type='button']")) as HTMLInputElement | null;

        const parentButton = targetEl.closest<HTMLElement>(
          ".a-button, .a-button-inner, [id*='submit.buy-now'], [id*='submit.add-to-cart'], [id*='buyNow'], [id*='addToCart']"
        );
        const announceSpan = (parentButton?.querySelector<HTMLElement>(".a-button-text, [id*='announce']") || targetEl) as HTMLElement;

        // Scroll into center view
        (parentButton || targetEl).scrollIntoView({ behavior: "smooth", block: "center" });

        // Highlight
        const rect = (parentButton || targetEl).getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.border = "3px solid #f59e0b";
        overlay.style.boxShadow = "0 0 25px rgba(245, 158, 11, 0.95)";
        overlay.style.borderRadius = "8px";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "2147483647";
        document.body.appendChild(overlay);
        setTimeout(() => overlay.remove(), 1200);

        // Click all relevant elements in the hierarchy
        const elementsToClick = Array.from(new Set([announceSpan, inputEl, parentButton, targetEl])).filter(Boolean) as HTMLElement[];
        for (const el of elementsToClick) {
          el.focus();
          el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window, composed: true }));
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, buttons: 1, composed: true }));
          el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window, composed: true }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, composed: true }));
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, composed: true }));
          try {
            el.click();
          } catch (e) {}
        }

        // Also trigger form.requestSubmit if input is part of a form
        if (inputEl && inputEl.form) {
          try {
            inputEl.form.requestSubmit(inputEl);
          } catch (e) {
            try {
              inputEl.form.submit();
            } catch (err) {}
          }
        }

        return {
          success: true,
          result: `Successfully clicked e-commerce action <${targetEl.tagName.toLowerCase()}> ${targetEl.id || targetEl.getAttribute("name") || "button"}`
        };
      }

      // 1. ANCHOR CHECK: Clean in-tab navigation (Guaranteed ZERO duplicate tabs)
      const anchor = (targetEl.tagName.toLowerCase() === "a" ? targetEl : targetEl.closest("a")) as HTMLAnchorElement | null;
      if (anchor && anchor.href && !anchor.href.startsWith("javascript:") && anchor.getAttribute("href") !== "#") {
        // Strip target="_blank" so the browser NEVER spawns duplicate external tabs
        anchor.removeAttribute("target");
        anchor.target = "_self";
        const destUrl = anchor.href;

        // Visual feedback highlight
        const rect = (anchor || targetEl).getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.border = "2px solid #38bdf8";
        overlay.style.boxShadow = "0 0 16px rgba(56, 189, 248, 0.85)";
        overlay.style.borderRadius = "4px";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "2147483647";
        document.body.appendChild(overlay);

        // Schedule in-tab navigation (50ms buffer ensures message response delivers cleanly to SidePanel)
        setTimeout(() => {
          window.location.href = destUrl;
        }, 50);

        return {
          success: true,
          result: `Navigating in active tab to ${destUrl}`
        };
      }

      // 2. NON-ANCHOR ELEMENTS (Buttons, inputs, custom controls)
      if (typeof action.targetIndex === "number") {
        highlightElementByIndex(action.targetIndex);
      } else {
        const rect = targetEl.getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.border = "2px solid #38bdf8";
        overlay.style.boxShadow = "0 0 16px rgba(56, 189, 248, 0.85)";
        overlay.style.borderRadius = "4px";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "2147483647";
        document.body.appendChild(overlay);
        setTimeout(() => overlay.remove(), 900);
      }
      setTimeout(clearHighlightOverlay, 900);

      targetEl.focus();
      targetEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
      targetEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, buttons: 1 }));
      targetEl.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window }));
      targetEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      targetEl.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      targetEl.click();

      // Spotify track rows start playback upon double-click
      if (window.location.hostname.includes("spotify.com")) {
        targetEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      }

      // Trigger wrapped parent container if applicable (e.g. Amazon .a-button or #submit.buy-now)
      const aButtonWrap = targetEl.closest<HTMLElement>(".a-button, .a-button-inner, [id*='buy-now'], [id*='add-to-cart']");
      if (aButtonWrap && aButtonWrap !== targetEl) {
        aButtonWrap.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        aButtonWrap.click?.();
      }

      return {
        success: true,
        result: `Successfully clicked <${targetEl.tagName.toLowerCase()}> ${(targetEl.innerText || targetEl.getAttribute("aria-label") || "").slice(0, 30)}`
      };
    }

    if (action.action === "type") {
      const inputEl = targetEl as (HTMLInputElement | HTMLTextAreaElement);

      // Smooth scroll into center view
      inputEl.scrollIntoView({ behavior: "smooth", block: "center" });
      inputEl.focus();

      // Sleek glowing HUD highlight around active search bar
      const rect = inputEl.getBoundingClientRect();
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.border = "2px solid #06b6d4";
      overlay.style.boxShadow = "0 0 20px rgba(6, 182, 212, 0.9)";
      overlay.style.borderRadius = "6px";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "2147483647";
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 1200);

      inputEl.dispatchEvent(new Event("focus", { bubbles: true }));

      // Framework-compatible setter for React / modern SPAs (Spotify, YouTube, Google, Twitter)
      const isTextArea = inputEl instanceof HTMLTextAreaElement;
      const proto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(inputEl, action.value || "");
      } else {
        (inputEl as any).value = action.value || "";
      }

      inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      try {
        inputEl.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: action.value || "",
          inputType: "insertText"
        }));
      } catch (e) {}

      // Dispatch full Enter keyboard sequence if action.pressEnter is true (default for search commands)
      if (action.pressEnter) {
        const enterOptions = {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        };
        inputEl.dispatchEvent(new KeyboardEvent("keydown", enterOptions));
        inputEl.dispatchEvent(new KeyboardEvent("keypress", enterOptions));
        inputEl.dispatchEvent(new KeyboardEvent("keyup", enterOptions));

        // If input is enclosed in a form, request submit
        try {
          if (inputEl.form) {
            if (typeof inputEl.form.requestSubmit === "function") {
              inputEl.form.requestSubmit();
            } else {
              inputEl.form.submit();
            }
          }
        } catch (formErr) {
          console.log("Form requestSubmit caught:", formErr);
        }

        // Also trigger companion search/submit button if present (YouTube #search-icon-legacy, Amazon submit button, etc.)
        const container = inputEl.closest("form, header, nav, [role='search'], div") || inputEl.parentElement;
        if (container) {
          const searchBtn = container.querySelector<HTMLElement>(
            "#btn-search, #nav-search-submit-button, #search-icon-legacy, button[type='submit'], input[type='submit'], button[id*='search' i], button[class*='search' i], button[aria-label*='search' i]"
          );
          if (searchBtn && searchBtn !== targetEl) {
            searchBtn.click();
          }
        }
      }

      return {
        success: true,
        result: `Searched for '${action.value}' in active site search bar`
      };
    }

    if (action.action === "press_key") {
      const activeEl = (targetEl || document.activeElement || document.body) as HTMLElement;
      const keyName = action.keyName || action.value || "Enter";
      const keyCode = keyName === "Enter" ? 13 : keyName === "Tab" ? 9 : keyName === "Escape" ? 27 : 0;
      const keyOpts = {
        key: keyName,
        code: keyName,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      };
      activeEl.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
      activeEl.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
      activeEl.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
      return {
        success: true,
        result: `Simulated keypress '${keyName}' on <${activeEl.tagName.toLowerCase()}>`
      };
    }

    if (action.action === "hover") {
      targetEl.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, composed: true }));
      targetEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, composed: true }));
      targetEl.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, composed: true }));
      return {
        success: true,
        result: `Hovered over <${targetEl.tagName.toLowerCase()}>`
      };
    }

    if (action.action === "select" && action.value) {
      if (targetEl.tagName.toLowerCase() === "select") {
        const sel = targetEl as HTMLSelectElement;
        const targetVal = action.value.toLowerCase().trim();
        let matched = false;
        for (let i = 0; i < sel.options.length; i++) {
          const opt = sel.options[i];
          if (opt.value.toLowerCase() === targetVal || (opt.text && opt.text.toLowerCase().includes(targetVal))) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            matched = true;
            break;
          }
        }
        if (matched) {
          return { success: true, result: `Selected '${action.value}' in <select>` };
        }
      }
    }

    return { success: false, error: `Unsupported action: ${action.action}` };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Unknown execution error"
    };
  }
}

function autoFillFormLocally(
  profile: UserVaultProfile,
  customData?: Record<string, string>
): { success: boolean; filledCount: number; fields: string[] } {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']), textarea, select"
    )
  );

  let filledCount = 0;
  const filledFields: string[] = [];

  for (const input of inputs) {
    const isSelect = input.tagName.toLowerCase() === "select";
    const type = (input.getAttribute("type") || "").toLowerCase();
    const name = (input.getAttribute("name") || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const placeholder = (input.getAttribute("placeholder") || "").toLowerCase();
    const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();

    // Find nearby label text if present
    let labelText = "";
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) labelText = (label.textContent || "").toLowerCase();
    }
    if (!labelText && input.closest("label")) {
      labelText = (input.closest("label")?.textContent || "").toLowerCase();
    }

    const descriptor = `${name} ${id} ${placeholder} ${ariaLabel} ${labelText} ${type}`;

    // Handle Radio Buttons for Gender
    if (type === "radio" && /gender|sex\b/i.test(descriptor) && profile.gender) {
      const rVal = (input.getAttribute("value") || "").toLowerCase();
      const pGender = profile.gender.toLowerCase();
      if (rVal === pGender || labelText.includes(pGender) || (pGender === "male" && rVal === "m") || (pGender === "female" && rVal === "f")) {
        (input as HTMLInputElement).checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        filledCount++;
        filledFields.push(`Gender: ${profile.gender}`);
        continue;
      }
    }

    // Skip other radio and checkbox inputs
    if (type === "radio" || type === "checkbox") continue;

    let valToFill = "";
    let fieldCategory = "";

    // 1. Dynamic in-flight custom data matching (e.g. from user prompt)
    if (customData && typeof customData === "object") {
      for (const [key, val] of Object.entries(customData)) {
        const cleanK = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        const cleanDesc = descriptor.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleanK.length >= 2 && cleanDesc.includes(cleanK)) {
          valToFill = val;
          fieldCategory = key;
          break;
        }
      }
    }

    // 2. Persona / Profile Vault matching
    if (!valToFill) {
      if (/aadhaar|aadhar|uidai/i.test(descriptor) && profile.aadhaarMock) {
        valToFill = profile.aadhaarMock;
        fieldCategory = "Aadhaar";
      } else if (/\bpan\b|pancard/i.test(descriptor) && profile.panMock) {
        valToFill = profile.panMock;
        fieldCategory = "PAN";
      } else if (/passport/i.test(descriptor) && profile.passportMock) {
        valToFill = profile.passportMock;
        fieldCategory = "Passport";
      } else if (/dl\b|driving.*licen/i.test(descriptor) && profile.drivingLicenseMock) {
        valToFill = profile.drivingLicenseMock;
        fieldCategory = "Driving License";
      } else if (/gender|sex\b/i.test(descriptor) && profile.gender) {
        valToFill = profile.gender;
        fieldCategory = "Gender";
      } else if (/dob|birth|bday|date[_\s-]?of[_\s-]?birth/i.test(descriptor) || type === "date") {
        if (profile.dob) {
          valToFill = profile.dob;
          fieldCategory = "DOB";
        }
      } else if (/alt.*phone|emergency.*phone|secondary.*phone|alt.*mobile/i.test(descriptor) && profile.alternatePhone) {
        valToFill = profile.alternatePhone;
        fieldCategory = "Alternate Phone";
      } else if (/email|e-mail/i.test(descriptor) || type === "email") {
        if (profile.email) {
          valToFill = profile.email;
          fieldCategory = "Email";
        }
      } else if (/phone|mobile|tel|contact/i.test(descriptor) || type === "tel") {
        if (profile.phone) {
          valToFill = profile.phone;
          fieldCategory = "Phone";
        }
      } else if (/first[_\s-]?name|fname/i.test(descriptor)) {
        if (profile.fullName) {
          valToFill = profile.fullName.split(" ")[0];
          fieldCategory = "First Name";
        }
      } else if (/last[_\s-]?name|lname/i.test(descriptor)) {
        if (profile.fullName) {
          const parts = profile.fullName.split(" ");
          valToFill = parts.length > 1 ? parts.slice(1).join(" ") : "";
          fieldCategory = "Last Name";
        }
      } else if (/full[_\s-]?name|name|customer|recipient/i.test(descriptor) && !/user|login|pass/i.test(descriptor)) {
        if (profile.fullName) {
          valToFill = profile.fullName;
          fieldCategory = "Full Name";
        }
      } else if (/pincode|postal|zip/i.test(descriptor)) {
        if (profile.pincode) {
          valToFill = profile.pincode;
          fieldCategory = "Pincode";
        }
      } else if (
        /address|street|flat|house|building|suite|line[_\s-]?1|addr[_\s-]?1|addr\b/i.test(descriptor) &&
        !/landmark/i.test(name + " " + id + " " + labelText)
      ) {
        if (profile.address) {
          valToFill = profile.address;
          fieldCategory = "Address";
        }
      } else if (/landmark|locality/i.test(descriptor) && profile.landmark) {
        valToFill = profile.landmark;
        fieldCategory = "Landmark";
      } else if (/city|town|district/i.test(descriptor)) {
        if (profile.city) {
          valToFill = profile.city;
          fieldCategory = "City";
        }
      } else if (/state|province|region/i.test(descriptor) && profile.state) {
        valToFill = profile.state;
        fieldCategory = "State";
      } else if (/country|nation/i.test(descriptor) && profile.country) {
        valToFill = profile.country;
        fieldCategory = "Country";
      } else if (/company|organization|org\b|business.*name|employer/i.test(descriptor) && profile.company) {
        valToFill = profile.company;
        fieldCategory = "Company";
      } else if (/job.*title|role|designation|occupation/i.test(descriptor) && profile.jobTitle) {
        valToFill = profile.jobTitle;
        fieldCategory = "Job Title";
      } else if (/website|portfolio|url/i.test(descriptor) && profile.website) {
        valToFill = profile.website;
        fieldCategory = "Website";
      } else if (/notes|comments?|message|description|feedback|inquiry/i.test(descriptor) && profile.notes) {
        valToFill = profile.notes;
        fieldCategory = "Notes";
      }
    }

    if (valToFill) {
      if (isSelect) {
        const select = input as HTMLSelectElement;
        const targetVal = valToFill.toLowerCase();
        let matched = false;
        for (let i = 0; i < select.options.length; i++) {
          const opt = select.options[i];
          const optText = (opt.text || "").toLowerCase();
          const optVal = (opt.value || "").toLowerCase();
          if (optVal === targetVal || optText === targetVal || optText.includes(targetVal) || targetVal.includes(optText)) {
            select.selectedIndex = i;
            select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            matched = true;
            break;
          }
        }
        if (matched) {
          filledCount++;
          filledFields.push(`${fieldCategory}: ${valToFill}`);
        }
      } else {
        input.focus();
        const proto = input.tagName.toLowerCase() === "textarea"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (nativeSetter) {
          nativeSetter.call(input, valToFill);
        } else {
          input.value = valToFill;
        }
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

        // Green privacy shield glow animation on filled input
        input.style.transition = "box-shadow 0.3s ease, border-color 0.3s ease";
        input.style.borderColor = "#10b981";
        input.style.boxShadow = "0 0 10px rgba(16, 185, 129, 0.75)";

        setTimeout(() => {
          input.style.boxShadow = "";
          input.style.borderColor = "";
        }, 3000);

        filledCount++;
        filledFields.push(`${fieldCategory}: ${valToFill.slice(0, 4)}••••`);
      }
    }
  }

  return {
    success: filledCount > 0,
    filledCount,
    fields: filledFields
  };
}

function deepSearchPage(query: string): DeepNavResult {
  const queryClean = query.toLowerCase().trim();
  const queryTokens = queryClean.split(/\s+/).filter((t) => t.length > 2);

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("a[href], button, summary, [role='button'], [role='link'], footer a, nav a, header a")
  );

  let bestMatch: HTMLElement | null = null;
  let bestScore = 0;

  for (const el of candidates) {
    const text = (el.innerText || el.textContent || "").toLowerCase().trim();
    const title = (el.getAttribute("title") || "").toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
    const href = (el.getAttribute("href") || "").toLowerCase();
    const combined = `${text} ${title} ${ariaLabel} ${href}`;

    let score = 0;
    if (combined.includes(queryClean)) {
      score += 15;
    }
    for (const tok of queryTokens) {
      if (combined.includes(tok)) {
        score += 3;
      }
    }

    // Boost if in footer or navigation (buried areas)
    if (el.closest("footer")) score += 4;
    if (el.closest("nav") || el.closest("header")) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = el;
    }
  }

  if (bestMatch && bestScore >= 3) {
    bestMatch.scrollIntoView({ behavior: "smooth", block: "center" });

    // Highlight target
    const rect = bestMatch.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = `${Math.round(rect.left)}px`;
    overlay.style.top = `${Math.round(rect.top)}px`;
    overlay.style.width = `${Math.round(rect.width)}px`;
    overlay.style.height = `${Math.round(rect.height)}px`;
    overlay.style.border = "2px solid #10b981";
    overlay.style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.9)";
    overlay.style.borderRadius = "4px";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";

    const tag = document.createElement("span");
    tag.innerText = `[DEEP NAV]: Found '${(bestMatch.innerText || "Target").slice(0, 30)}'`;
    tag.style.position = "absolute";
    tag.style.top = "-24px";
    tag.style.left = "0";
    tag.style.background = "#064e3b";
    tag.style.color = "#34d399";
    tag.style.fontSize = "11px";
    tag.style.fontWeight = "bold";
    tag.style.padding = "2px 8px";
    tag.style.borderRadius = "3px";
    tag.style.whiteSpace = "nowrap";
    overlay.appendChild(tag);

    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 4000);

    const locationDesc = bestMatch.closest("footer")
      ? "Page Footer"
      : bestMatch.closest("nav")
      ? "Navigation Bar"
      : bestMatch.closest("header")
      ? "Page Header"
      : "Main Content";

    return {
      found: true,
      elementText: (bestMatch.innerText || bestMatch.getAttribute("aria-label") || "Link").trim(),
      selector: getUniqueSelector(bestMatch),
      locationDescription: locationDesc
    };
  }

  return {
    found: false,
    elementText: "",
    selector: "",
    locationDescription: ""
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_INFO") {
    const pageInfo = getPageInformation();
    sendResponse({ success: true, data: pageInfo });
    return true;
  }

  if (message?.type === "HIGHLIGHT_ELEMENT") {
    highlightElementByIndex(message.index);
    sendResponse({ success: true });
    return true;
  }

  if (message?.type === "CLEAR_HIGHLIGHT") {
    clearHighlightOverlay();
    sendResponse({ success: true });
    return true;
  }

  if (message?.type === "EXECUTE_ACTION") {
    executeAgentAction(message.action).then((res) => {
      sendResponse(res);
    });
    return true;
  }

  if (message?.type === "AUTOFILL_FORM") {
    const result = autoFillFormLocally(message.profile, message.customData);
    sendResponse({
      type: "AUTOFILL_RESULT",
      success: result.success,
      filledCount: result.filledCount,
      fields: result.fields
    });
    return true;
  }

  if (message?.type === "DEEP_SEARCH") {
    const result = deepSearchPage(message.query);
    sendResponse({
      type: "DEEP_SEARCH_RESULT",
      success: result.found,
      result
    });
    return true;
  }

  return false;
});


