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

async function executeAgentAction(
  action: AgentAction
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    if (action.action === "scroll") {
      if (action.direction === "top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return { success: true, result: "Scrolled smoothly to top of page" };
      }
      if (action.direction === "bottom") {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        return { success: true, result: "Scrolled smoothly to bottom of page" };
      }
      const amount = action.amount || 500;
      const top = action.direction === "up" ? -amount : amount;
      window.scrollBy({ top, behavior: "smooth" });
      return { success: true, result: `Scrolled window ${action.direction === "up" ? "up" : "down"} by ${amount}px` };
    }

    if (action.action === "navigate" && action.value) {
      window.location.href = action.value;
      return { success: true, result: `Navigating to ${action.value}` };
    }

    if (action.action === "wait") {
      const duration = action.amount || 1000;
      await new Promise((r) => setTimeout(r, duration));
      return { success: true, result: `Waited ${duration}ms` };
    }

    if (action.action === "finish") {
      return { success: true, result: "Task marked completed by agent" };
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
        if (!targetEl) {
          targetEl = document.querySelector<HTMLElement>("[data-component-type='s-add-to-cart-button'] button, button.a-button-text[name*='add-to-cart']");
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

        // Extract query terms (e.g. "acer", "aspire", "5", "macbook", "laptop")
        const rawClean = term
          .replace(/^(?:open|select)\s+product(?:\s*:)?\s*/i, "")
          .replace(/and\s+add\s+to\s+cart/i, "")
          .trim()
          .toLowerCase();
        const queryWords = rawClean
          .split(/\s+/)
          .filter((w) => (w.length >= 2 || /\d/.test(w)) && !["search", "for", "the", "and", "add", "cart", "product"].includes(w));

        const searchCards = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-component-type='s-search-result'], .s-result-item[data-asin]:not([data-asin='']), .product-card"
          )
        );

        if (searchCards.length > 0) {
          let bestCard: HTMLElement | null = null;
          let bestScore = 0; // Require at least 1 positive keyword match!

          for (const card of searchCards) {
            const titleEl = card.querySelector<HTMLElement>("h2 a, .s-title-instructions-style a, a.a-link-normal.s-underline-text");
            if (!titleEl) continue;
            const titleText = (titleEl.innerText || titleEl.textContent || "").toLowerCase();

            // Strict exclusion: never pick an accessory when looking for a primary computing/phone device
            const isAccessory = titleText.includes("stand") || titleText.includes("case") || titleText.includes("sleeve") || 
                                titleText.includes("skin") || titleText.includes("adapter") || titleText.includes("cover") || 
                                titleText.includes("protector") || titleText.includes("cable") || titleText.includes("hub");

            if (isAccessory && queryWords.some((w) => ["macbook", "laptop", "iphone", "ipad"].includes(w))) {
              continue;
            }

            let score = 0;
            for (const w of queryWords) {
              if (titleText.includes(w)) {
                score += (w === "macbook" || w === "laptop" || w === "apple" || w === "acer" || w === "aspire" ? 5 : 2);
              }
            }

            if (score > bestScore) {
              bestScore = score;
              bestCard = titleEl;
            }
          }

          if (bestCard && bestScore >= 2) {
            targetEl = bestCard;
          }
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



    // Fallback for search typing if no specific input was resolved
    if (!targetEl && action.action === "type") {
      targetEl = document.querySelector<HTMLElement>(
        "#site-search, input[type='search'], input[name*='search' i], input[id*='search' i], input[placeholder*='search' i], input[name='q'], #twotabsearchtextbox, input[type='text'], textarea"
      );
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
      targetEl.focus();
      const inputEl = targetEl as HTMLInputElement;

      inputEl.dispatchEvent(new Event("focus", { bubbles: true }));

      // Framework-compatible setter for React / modern SPAs
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(inputEl, action.value || "");
      } else {
        inputEl.value = action.value || "";
      }

      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true }));

      // Dispatch full Enter keyboard sequence (keydown, keypress, keyup with keyCode 13)
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

      // Also trigger companion search/submit button if present
      const container = inputEl.closest("form, header, nav, [role='search'], div") || inputEl.parentElement;
      if (container) {
        const searchBtn = container.querySelector<HTMLElement>(
          "#btn-search, #nav-search-submit-button, #search-icon-legacy, button[type='submit'], input[type='submit'], button[id*='search' i], button[class*='search' i], button[aria-label*='search' i]"
        );
        if (searchBtn && searchBtn !== targetEl) {
          searchBtn.click();
        }
      }

      return {
        success: true,
        result: `Typed '${action.value}' into <${targetEl.tagName.toLowerCase()}> and pressed Enter`
      };
    }

    return { success: false, error: `Unsupported action: ${action.action}` };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Unknown execution error"
    };
  }
}

function autoFillFormLocally(profile: UserVaultProfile): { success: boolean; filledCount: number; fields: string[] } {
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
        input.dispatchEvent(new Event("change", { bubbles: true }));
        filledCount++;
        filledFields.push(`Gender: ${profile.gender}`);
        continue;
      }
    }

    // Skip other radio and checkbox inputs
    if (type === "radio" || type === "checkbox") continue;

    let valToFill = "";
    let fieldCategory = "";

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
            select.dispatchEvent(new Event("change", { bubbles: true }));
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
        input.value = valToFill;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));

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
    const result = autoFillFormLocally(message.profile);
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


