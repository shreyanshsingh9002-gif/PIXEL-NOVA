import {
  PIICategory,
  PIIEntity,
  RiskLevel,
  BoundingBox,
  InteractiveElement,
  PrivacyScore
} from "../shared/types";
import { edgeMLClassifier } from "./mlClassifier";

// Luhn algorithm for valid credit/debit card numbers
function isValidLuhn(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Computes a normalized canonical key for a PII entity so variations
 * of the exact same value (e.g. phone with spaces/dashes vs raw digits,
 * email case variations, aadhaar with spaces vs hyphens) map to the SAME key.
 */
export function getCanonicalEntityKey(category: PIICategory, rawValue: string): string {
  if (!rawValue) return `${category}_empty`;
  const clean = rawValue.trim();

  switch (category) {
    case "EMAIL":
      return `email_${clean.toLowerCase()}`;

    case "PHONE": {
      const digits = clean.replace(/\D/g, "");
      let core = digits;
      if (core.length === 12 && core.startsWith("91")) {
        core = core.slice(2);
      } else if (core.length === 11 && (core.startsWith("0") || core.startsWith("1"))) {
        core = core.slice(1);
      }
      if (core.length >= 10) {
        return `phone_${core.slice(-10)}`;
      }
      return `phone_${core || clean}`;
    }

    case "AADHAAR": {
      const digits = clean.replace(/\D/g, "");
      if (digits.length === 12) {
        return `aadhaar_${digits}`;
      }
      return `aadhaar_${digits || clean}`;
    }

    case "PAN":
      return `pan_${clean.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;

    case "CARD": {
      const digits = clean.replace(/\D/g, "");
      return `card_${digits}`;
    }

    case "CARD_EXPIRY":
      return `exp_${clean.replace(/[\s\/-]/g, "").toLowerCase()}`;

    case "CVV":
      return `cvv_${clean.replace(/\D/g, "")}`;

    case "OTP":
      return `otp_${clean.replace(/\D/g, "")}`;

    case "NAME":
      return `name_${clean.toLowerCase().replace(/\s+/g, " ")}`;

    case "ADDRESS":
      return `addr_${clean.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 35)}`;

    default:
      return `${category.toLowerCase()}_${clean.toLowerCase().replace(/\s+/g, " ")}`;
  }
}

// Detection patterns
const PATTERNS: Array<{
  category: PIICategory;
  risk: RiskLevel;
  regex: RegExp;
  validator?: (match: string) => boolean;
}> = [
  // Email addresses
  {
    category: "EMAIL",
    risk: "LOW",
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
  },
  // Indian Mobile numbers (+91 or 10-digit starting with 6-9)
  {
    category: "PHONE",
    risk: "MEDIUM",
    regex: /(?:\+91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}\b/g
  },
  // Standard International / US Phone numbers (strictly bound to avoid partial +91 collision)
  {
    category: "PHONE",
    risk: "MEDIUM",
    regex: /(?<![\d+])(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
  },
  // Indian Aadhaar Number: 12 digits, often 4-4-4 formatted (Lookahead prevents matching 16-digit cards)
  {
    category: "AADHAAR",
    regex: /(?<!\d[-\s]?)\b[2-9]\d{3}[-\s]?\d{4}[-\s]?\d{4}\b(?![-\s]?\d)/g,
    validator: (match) => {
      const clean = match.replace(/\D/g, "");
      if (clean.length !== 12) return false;
      if (/^(\d)\1{11}$/.test(clean)) return false;
      return true;
    }
  },
  // Indian PAN Card: 5 letters, 4 digits, 1 letter
  {
    category: "PAN",
    risk: "HIGH",
    regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g
  },
  // Credit / Debit Cards (13 to 19 digits, space or hyphen separated)
  {
    category: "CARD",
    risk: "HIGH",
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b(?:\d{4}[-\s]?){2}\d{4}[-\s]?\d{3}\b/g,
    validator: (match) => {
      const clean = match.replace(/[-\s]/g, "");
      return clean.length >= 13 && clean.length <= 19 && isValidLuhn(clean);
    }
  },
  // Card CVV / CVC (3 or 4 digits preceded by CVV, CVC, or Security Code label)
  {
    category: "CVV",
    risk: "HIGH",
    regex: /\b(?:cvv|cvc|security\s*code|card\s*code|cvn)\s*[:#-]?\s*([0-9]{3,4})\b/gi
  },
  // Card Expiry Date (MM/YY or MM/YYYY preceded by Exp, Expiry, Expires, Valid Thru)
  {
    category: "CARD_EXPIRY",
    risk: "HIGH",
    regex: /\b(?:exp(?:iry|ires)?|valid\s*(?:thru|through|till))\s*[:#-]?\s*((?:0[1-9]|1[0-2])[\/\-](?:20)?\d{2})\b/gi
  },
  // One-Time Passwords (OTP) / 2FA Verification Codes
  {
    category: "OTP",
    risk: "HIGH",
    regex: /\b(?:otp|one[- ]?time[- ]?password|verification\s*code|auth\s*code|security\s*code|login\s*code|code\s*is)\s*(?:is|:|-)?\s*([0-9]{4,8})\b/gi
  },
  // Delivery & Residential Addresses (Street/Flat/Sector + PIN/City)
  {
    category: "ADDRESS",
    risk: "MEDIUM",
    regex: /\b(?:Flat\s+\d+|House\s+No|Plot\s+No|H\.?\s*No|Block\s+[A-Z0-9]+|Sector\s+\d+|Phase\s+\d+|Floor\s+\d+|Apartments?|Palms?|Residency|Vihar|Colony|Enclave|Nagar|Marg|Road|Street|Lane|Avenue)\b[^\n\r<]{8,90}(?:\b[1-9][0-9]{5}\b|\b\d{5}(?:-\d{4})?\b|[A-Za-z]+(?:\s+[A-Za-z]+)?\s+\d{5,6})/gi
  },
  // Labeled Delivery Address (e.g. Delivery Address: Flat 402, Royal Palms ...)
  {
    category: "ADDRESS",
    risk: "MEDIUM",
    regex: /\b(?:delivery\s+|shipping\s+|billing\s+|residential\s+|home\s+)?address\s*[:#-]?\s*([^\n\r<]{12,110})/gi
  },
  // API Keys / Secrets / Tokens
  {
    category: "SECRET",
    risk: "HIGH",
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)\b/g
  }
];

/**
 * Global entity deduplicator that merges duplicate entity instances,
 * consolidates bounding boxes across DOM occurrences, and assigns clean, unique masked tokens.
 */
export function deduplicateEntities(rawEntities: PIIEntity[]): PIIEntity[] {
  const seenKeys = new Map<string, PIIEntity>();

  for (const ent of rawEntities) {
    if (!ent.value || ent.value.trim().length < 2) continue;
    const key = getCanonicalEntityKey(ent.category, ent.value);

    if (!seenKeys.has(key)) {
      seenKeys.set(key, { ...ent });
    } else {
      const existing = seenKeys.get(key)!;
      // Merge bounding box if existing didn't have one
      if (!existing.boundingBox && ent.boundingBox) {
        existing.boundingBox = ent.boundingBox;
      }
      // If ent has elementIndex and existing does not, copy it
      if (existing.elementIndex === undefined && ent.elementIndex !== undefined) {
        existing.elementIndex = ent.elementIndex;
        existing.selector = ent.selector;
      }
      // Keep higher confidence
      if ((ent.confidence || 0) > (existing.confidence || 0)) {
        existing.confidence = ent.confidence;
      }
      // Keep formatted string if richer (e.g. "+91 9876543210" over "9876543210")
      if (
        ent.value.length > existing.value.length &&
        (ent.value.includes("+") || ent.value.includes("@") || ent.value.includes(" ") || ent.value.includes("-"))
      ) {
        existing.value = ent.value;
      }
    }
  }

  // Re-index masked values cleanly ([EMAIL_1], [PHONE_1], [AADHAAR_1], etc.)
  const categoryCounters: Record<string, number> = {};
  const deduped: PIIEntity[] = [];

  for (const ent of seenKeys.values()) {
    const cat = ent.category;
    categoryCounters[cat] = (categoryCounters[cat] || 0) + 1;
    const count = categoryCounters[cat];

    let maskedValue = `[${cat}_${count}]`;
    if (cat === "CVV") maskedValue = "███";
    else if (cat === "OTP") maskedValue = "██████";
    else if (cat === "CARD_EXPIRY") maskedValue = "[CARD_EXPIRY]";
    else if (cat === "ADDRESS") maskedValue = "[REDACTED_ADDRESS]";
    else if (cat === "PASSWORD") maskedValue = "████████";
    else if (cat === "NAME") maskedValue = "[REDACTED_NAME]";

    ent.id = `pii_${cat.toLowerCase()}_${count}`;
    ent.maskedValue = maskedValue;
    deduped.push(ent);
  }

  return deduped;
}

export function detectPII(
  text: string,
  interactiveElements: InteractiveElement[] = []
): { entities: PIIEntity[]; score: PrivacyScore } {
  const entities: PIIEntity[] = [];
  let entityCounter = 0;

  // 1. Text-based Regex Pattern Scanning
  for (const pattern of PATTERNS) {
    const matches = Array.from(text.matchAll(pattern.regex));
    for (const match of matches) {
      // If regex has capture group (e.g. for CVV/OTP/Expiry/Address), extract group 1; otherwise match[0]
      const val = (match[1] || match[0]).trim();
      if (!val || val.length < 2) continue;

      if (pattern.validator && !pattern.validator(val)) {
        continue;
      }

      // Avoid duplicates using canonical key
      const key = getCanonicalEntityKey(pattern.category, val);
      const exists = entities.some(
        (e) => getCanonicalEntityKey(e.category, e.value) === key
      );
      if (!exists) {
        entityCounter++;
        let maskedValue = `[${pattern.category}_${entityCounter}]`;
        if (pattern.category === "CVV") maskedValue = "███";
        else if (pattern.category === "OTP") maskedValue = "██████";
        else if (pattern.category === "CARD_EXPIRY") maskedValue = "[CARD_EXPIRY]";
        else if (pattern.category === "ADDRESS") maskedValue = "[REDACTED_ADDRESS]";

        entities.push({
          id: `pii_${pattern.category.toLowerCase()}_${entityCounter}`,
          category: pattern.category,
          value: val,
          maskedValue,
          risk: pattern.risk,
          detectionSource: "RULEBOOK",
          confidence: 0.99
        });
      }
    }
  }

  // 2. DOM-based Heuristics on Interactive Elements
  interactiveElements.forEach((el) => {
    const lowerName = (el.name || "").toLowerCase();
    const lowerId = (el.id || "").toLowerCase();
    const lowerPlaceholder = (el.placeholder || "").toLowerCase();
    const lowerLabel = (el.ariaLabel || "").toLowerCase();
    const lowerRole = (el.role || "").toLowerCase();
    const combinedAttrs = `${lowerName} ${lowerId} ${lowerPlaceholder} ${lowerLabel} ${lowerRole}`;

    const isSearchField =
      el.type === "search" ||
      lowerName === "q" ||
      lowerRole === "searchbox" ||
      lowerRole === "search" ||
      combinedAttrs.includes("search") ||
      combinedAttrs.includes("query");

    // Passwords & Secrets
    if (el.type === "password" || combinedAttrs.includes("password") || combinedAttrs.includes("passwd")) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_password_${entityCounter}`,
        category: "PASSWORD",
        value: el.value || "••••••••",
        maskedValue: "████████",
        risk: "HIGH",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // CVV / CVC
    else if (combinedAttrs.includes("cvv") || combinedAttrs.includes("cvc") || combinedAttrs.includes("security code")) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_cvv_${entityCounter}`,
        category: "CVV",
        value: el.value || "•••",
        maskedValue: "███",
        risk: "HIGH",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // Card Expiry in inputs
    else if (combinedAttrs.includes("expir") || combinedAttrs.includes("valid thru") || combinedAttrs.includes("mm/yy") || lowerPlaceholder.includes("mm/yy")) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_expiry_${entityCounter}`,
        category: "CARD_EXPIRY",
        value: el.value || "MM/YY",
        maskedValue: "[CARD_EXPIRY]",
        risk: "HIGH",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // OTP in inputs
    else if (combinedAttrs.includes("otp") || combinedAttrs.includes("one-time-code") || combinedAttrs.includes("verification-code") || combinedAttrs.includes("auth code") || lowerPlaceholder.includes("otp")) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_otp_${entityCounter}`,
        category: "OTP",
        value: el.value || "••••••",
        maskedValue: "██████",
        risk: "HIGH",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // Cards in inputs
    else if (combinedAttrs.includes("card") || combinedAttrs.includes("creditcard") || combinedAttrs.includes("cardnumber")) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_card_${entityCounter}`,
        category: "CARD",
        value: el.value || "Card Input",
        maskedValue: "[CARD_INPUT]",
        risk: "HIGH",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // Address / City / State / Pincode in inputs (Exclude search inputs and do NOT flag bare textareas as addresses)
    else if (
      !isSearchField &&
      (combinedAttrs.includes("address") ||
        combinedAttrs.includes("street") ||
        combinedAttrs.includes("pincode") ||
        combinedAttrs.includes("postal") ||
        combinedAttrs.includes("city") ||
        combinedAttrs.includes("state") ||
        combinedAttrs.includes("zip") ||
        combinedAttrs.includes("district"))
    ) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_address_${entityCounter}`,
        category: "ADDRESS",
        value: el.value || "Delivery Address",
        maskedValue: "[REDACTED_ADDRESS]",
        risk: "MEDIUM",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // Aadhaar or PAN fields
    else if (combinedAttrs.includes("aadhaar") || combinedAttrs.includes("aadhar") || combinedAttrs.includes("uidai")) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_aadhaar_${entityCounter}`,
        category: "AADHAAR",
        value: el.value || "Aadhaar Field",
        maskedValue: "[AADHAAR_FIELD]",
        risk: "HIGH",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    else if (combinedAttrs.includes("pan") && !combinedAttrs.includes("panel")) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_pan_${entityCounter}`,
        category: "PAN",
        value: el.value || "PAN Field",
        maskedValue: "[PAN_FIELD]",
        risk: "HIGH",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // Email in inputs
    else if (
      el.type === "email" ||
      combinedAttrs.includes("email") ||
      combinedAttrs.includes("e-mail") ||
      combinedAttrs.includes("mail") ||
      (el.value && /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(el.value))
    ) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_email_${entityCounter}`,
        category: "EMAIL",
        value: el.value || "Email Field",
        maskedValue: `[EMAIL_${entityCounter}]`,
        risk: "MEDIUM",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // Phone in inputs
    else if (
      el.type === "tel" ||
      combinedAttrs.includes("phone") ||
      combinedAttrs.includes("mobile") ||
      combinedAttrs.includes("cell") ||
      combinedAttrs.includes("contact") ||
      (el.value && (/(?:\+91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}/.test(el.value) || /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(el.value)))
    ) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_phone_${entityCounter}`,
        category: "PHONE",
        value: el.value || "Phone Field",
        maskedValue: `[PHONE_${entityCounter}]`,
        risk: "MEDIUM",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
    // Full Name / Personal Name in inputs
    else if (
      !isSearchField &&
      (combinedAttrs.includes("full_name") ||
      combinedAttrs.includes("fullname") ||
      combinedAttrs.includes("recipient") ||
      combinedAttrs.includes("first_name") ||
      combinedAttrs.includes("last_name") ||
      combinedAttrs.includes("contact_name") ||
      (combinedAttrs.includes("name") && !combinedAttrs.includes("username") && !combinedAttrs.includes("hostname") && !combinedAttrs.includes("filename"))) &&
      el.value && el.value.trim().length > 0
    ) {
      entityCounter++;
      el.isSensitive = true;
      entities.push({
        id: `pii_name_${entityCounter}`,
        category: "NAME",
        value: el.value,
        maskedValue: "[REDACTED_NAME]",
        risk: "LOW",
        boundingBox: el.boundingBox,
        elementIndex: el.index,
        selector: el.selector
      });
    }
  });

  // 3. On-Device Contextual ML Sensitivity Pass (Kaggle Benchmark via WebGPU/WASM)
  const mlResult = edgeMLClassifier.classifyTextContextSync(text);
  for (const mlEntity of mlResult.entities) {
    const key = getCanonicalEntityKey(mlEntity.category, mlEntity.value);
    const exists = entities.some(
      (e) => getCanonicalEntityKey(e.category, e.value) === key
    );
    if (!exists) {
      entities.push(mlEntity);
    }
  }

  // Deduplicate and re-index all entities across regex, interactive elements & ML
  const finalEntities = deduplicateEntities(entities);

  // Calculate Privacy Risk Metrics
  const highRiskCount = finalEntities.filter((e) => e.risk === "HIGH").length;
  const mediumRiskCount = finalEntities.filter((e) => e.risk === "MEDIUM").length;
  const lowRiskCount = finalEntities.filter((e) => e.risk === "LOW").length;

  const overallScore = 100; // 100% Protection Coverage when entities are shielded

  const score: PrivacyScore = {
    overallScore,
    totalPIIDetected: finalEntities.length,
    totalRedacted: finalEntities.length,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    sensitivityScore: mlResult.sensitivityScore,
    mlModelName: mlResult.modelName,
    mlInferenceTimeMs: mlResult.inferenceTimeMs,
    hardwareBackend: mlResult.hardwareBackend
  };

  return { entities: finalEntities, score };
}

/**
 * Enhanced on-device detector that runs directly in the page DOM context (content script).
 * Accurately measures pixel coordinates (BoundingBox) for every text PII match using DOM Ranges.
 */
export function detectPIIInDOM(
  doc: Document,
  interactiveElements: InteractiveElement[] = []
): { entities: PIIEntity[]; score: PrivacyScore } {
  // Collect all text from body AND input values so text-based regex sees form values
  const inputValues = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .map((i) => (i.value || "").trim())
    .filter(Boolean)
    .join(" ");
  const pageText = `${(doc.body?.innerText || "").trim()}\n${inputValues}`;
  const { entities, score } = detectPII(pageText, interactiveElements);

  if (!doc.body) return { entities, score };

  let entityCounter = entities.length;

  const helperAddEntityWithBox = (
    category: PIICategory,
    val: string,
    maskedValue: string,
    risk: RiskLevel,
    el: HTMLElement
  ) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (!val || val.trim().length < 2) return;

    const key = getCanonicalEntityKey(category, val);
    const existing = entities.find(
      (e) => getCanonicalEntityKey(e.category, e.value) === key
    );
    if (existing) {
      if (!existing.boundingBox) {
        existing.boundingBox = {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        };
      }
      if (val.length > existing.value.length && (val.includes("+") || val.includes("@") || val.includes(" ") || val.includes("-"))) {
        existing.value = val;
      }
    } else {
      entityCounter++;
      entities.push({
        id: `pii_${category.toLowerCase()}_dom_${entityCounter}`,
        category,
        value: val,
        maskedValue,
        risk,
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        }
      });
    }
  };

  // 1. All <input> and <textarea> elements (email, phone, name, aadhaar, address, card, etc.)
  const allInputs = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  allInputs.forEach((inp) => {
    const val = (inp.value || "").trim();
    const type = (inp.getAttribute("type") || "").toLowerCase();
    const name = (inp.getAttribute("name") || "").toLowerCase();
    const id = (inp.id || "").toLowerCase();
    const placeholder = (inp.getAttribute("placeholder") || "").toLowerCase();
    const ariaLabel = (inp.getAttribute("aria-label") || "").toLowerCase();
    const role = (inp.getAttribute("role") || "").toLowerCase();
    const combined = `${type} ${name} ${id} ${placeholder} ${ariaLabel} ${role}`;

    // Skip submit, button, checkbox, radio, reset
    if (/^(submit|button|checkbox|radio|reset|image)$/.test(type)) return;

    // Never add dummy placeholder values ("user@domain.com", "+91 XXXXX XXXXX") when field is empty!
    if (!val || val.length < 2) {
      if (type === "password" || combined.includes("password") || combined.includes("passwd")) {
        helperAddEntityWithBox("PASSWORD", "••••••••", `████████`, "HIGH", inp);
      }
      return;
    }

    const isSearchField =
      type === "search" ||
      name === "q" ||
      role === "searchbox" ||
      role === "search" ||
      combined.includes("search") ||
      combined.includes("query");

    // Email
    if (
      type === "email" ||
      combined.includes("email") ||
      combined.includes("e-mail") ||
      combined.includes("mail") ||
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(val)
    ) {
      helperAddEntityWithBox("EMAIL", val, `[REDACTED_EMAIL]`, "MEDIUM", inp);
    }
    // Phone
    else if (
      type === "tel" ||
      combined.includes("phone") ||
      combined.includes("mobile") ||
      combined.includes("cell") ||
      combined.includes("contact") ||
      /(?:\+91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}/.test(val) ||
      /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(val)
    ) {
      helperAddEntityWithBox("PHONE", val, `[REDACTED_PHONE]`, "MEDIUM", inp);
    }
    // Name / Recipient
    else if (
      !isSearchField &&
      (combined.includes("name") || combined.includes("recipient") || combined.includes("customer")) &&
      !combined.includes("username") &&
      !combined.includes("hostname") &&
      val.length >= 2
    ) {
      helperAddEntityWithBox("NAME", val, `[REDACTED_NAME]`, "LOW", inp);
    }
    // Aadhaar / UIDAI
    else if (
      (combined.includes("aadhaar") || combined.includes("aadhar") || combined.includes("uidai")) &&
      val.length >= 4
    ) {
      helperAddEntityWithBox("AADHAAR", val, `[AADHAAR_FIELD]`, "HIGH", inp);
    }
    // PAN
    else if (combined.includes("pan") && !combined.includes("panel") && val.length >= 4) {
      helperAddEntityWithBox("PAN", val, `[PAN_FIELD]`, "HIGH", inp);
    }
    // Address / Street / City / State / Pincode / District (Exclude search fields)
    else if (
      !isSearchField &&
      (combined.includes("address") ||
        combined.includes("street") ||
        combined.includes("city") ||
        combined.includes("state") ||
        combined.includes("pincode") ||
        combined.includes("postal") ||
        combined.includes("zip") ||
        combined.includes("district")) &&
      val.length >= 2
    ) {
      helperAddEntityWithBox("ADDRESS", val, `[REDACTED_ADDRESS]`, "MEDIUM", inp);
    }
    // Password
    else if (type === "password" || combined.includes("password") || combined.includes("passwd")) {
      helperAddEntityWithBox("PASSWORD", val, `████████`, "HIGH", inp);
    }
  });

  // 2. Email elements in static DOM (e.g. #val-email or .email-val)
  const emailEls = doc.querySelectorAll<HTMLElement>("[id*='email' i], [class*='email' i]");
  emailEls.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const val = (el.innerText || "").trim();
    if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(val)) {
      helperAddEntityWithBox("EMAIL", val, `[REDACTED_EMAIL]`, "MEDIUM", el);
    }
  });

  // 3. Phone elements in static DOM (e.g. #val-phone or .phone-val)
  const phoneEls = doc.querySelectorAll<HTMLElement>("[id*='phone' i], [class*='phone' i], [id*='mobile' i], [class*='mobile' i]");
  phoneEls.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const val = (el.innerText || "").trim();
    if (/(?:\+91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}/.test(val) || /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(val)) {
      helperAddEntityWithBox("PHONE", val, `[REDACTED_PHONE]`, "MEDIUM", el);
    }
  });

  // 4. CVV elements (e.g. #val-cvv or elements labeled CVV/CVC)
  const cvvEls = doc.querySelectorAll<HTMLElement>("[id*='cvv' i], [class*='cvv' i], [id*='cvc' i], [class*='cvc' i]");
  cvvEls.forEach((el) => {
    const val = (el.innerText || (el as HTMLInputElement).value || "").trim();
    if (/^\d{3,4}$/.test(val)) {
      helperAddEntityWithBox("CVV", val, "███", "HIGH", el);
    }
  });

  // 5. Card Expiry elements (e.g. 08/29 inside credit cards or labeled EXPIRES)
  const expCandidates = doc.querySelectorAll<HTMLElement>(".credit-card *, .payment-cards *, [id*='exp' i], [class*='exp' i]");
  expCandidates.forEach((el) => {
    const val = (el.innerText || (el as HTMLInputElement).value || "").trim();
    if (/^(?:0[1-9]|1[0-2])[\/\-](?:20)?\d{2}$/.test(val)) {
      helperAddEntityWithBox("CARD_EXPIRY", val, "[CARD_EXPIRY]", "HIGH", el);
    }
  });

  // 6. Address / City / Pincode elements in static DOM (e.g. #val-address, #val-city)
  const addrEls = doc.querySelectorAll<HTMLElement>("[id*='address' i], [class*='address' i], [id*='city' i], [class*='city' i], [id*='pincode' i], [class*='pincode' i]");
  addrEls.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "search" || role === "searchbox" || el.closest("form[role='search'], [role='search']")) return;
    const val = (el.innerText || (el as HTMLInputElement).value || "").trim();
    if (val.length >= 3) {
      helperAddEntityWithBox("ADDRESS", val, "[REDACTED_ADDRESS]", "MEDIUM", el);
    }
  });

  // 7. OTP elements (e.g. #val-otp or labeled OTP / 2FA code)
  const otpEls = doc.querySelectorAll<HTMLElement>("[id*='otp' i], [class*='otp' i], [id*='verification' i]");
  otpEls.forEach((el) => {
    const val = (el.innerText || (el as HTMLInputElement).value || "").trim();
    if (/^\d{4,8}$/.test(val)) {
      helperAddEntityWithBox("OTP", val, "██████", "HIGH", el);
    }
  });

  // Deduplicate and re-index all entities across DOM & Regex
  const finalEntities = deduplicateEntities(entities);

  // Recalculate metrics based on deduplicated entities
  const highRiskCount = finalEntities.filter((e) => e.risk === "HIGH").length;
  const mediumRiskCount = finalEntities.filter((e) => e.risk === "MEDIUM").length;
  const lowRiskCount = finalEntities.filter((e) => e.risk === "LOW").length;
  score.overallScore = 100; // 100% Protection Coverage when entities are shielded
  score.totalPIIDetected = finalEntities.length;
  score.totalRedacted = finalEntities.length;
  score.highRiskCount = highRiskCount;
  score.mediumRiskCount = mediumRiskCount;
  score.lowRiskCount = lowRiskCount;

  // Collect text nodes for any entities that still don't have bounding boxes
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let currentNode: Node | null = walker.nextNode();
  while (currentNode) {
    if (currentNode.nodeType === Node.TEXT_NODE && (currentNode.textContent || "").trim().length > 0) {
      textNodes.push(currentNode as Text);
    }
    currentNode = walker.nextNode();
  }

  // Find bounding box for each remaining entity
  for (const entity of finalEntities) {
    if (entity.boundingBox && entity.boundingBox.width > 0) continue;

    const val = entity.value;
    if (!val || val.length < 2) continue;

    let foundBox = false;

    // Search text nodes via DOM Range
    for (const textNode of textNodes) {
      const content = textNode.textContent || "";
      const matchIndex = content.toLowerCase().indexOf(val.toLowerCase());
      if (matchIndex !== -1) {
        try {
          const range = doc.createRange();
          range.setStart(textNode, matchIndex);
          range.setEnd(textNode, matchIndex + val.length);
          const rect = range.getBoundingClientRect();

          if (rect.width > 0 && rect.height > 0) {
            entity.boundingBox = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              left: Math.round(rect.left)
            };
            foundBox = true;
            break;
          }
        } catch (e) {
          // Ignore range boundary errors
        }
      }
    }

    // Fallback 1: search enclosing DOM elements
    if (!foundBox) {
      const allElements = doc.querySelectorAll<HTMLElement>("p, span, div, td, th, li, strong, b, h1, h2, h3, h4, h5, h6, label, a");
      for (const el of allElements) {
        if (el.children.length <= 2 && (el.innerText || "").toLowerCase().includes(val.toLowerCase())) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            entity.boundingBox = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              left: Math.round(rect.left)
            };
            foundBox = true;
            break;
          }
        }
      }
    }

    // Fallback 2: search input/textarea elements for matching value
    if (!foundBox) {
      for (const inp of allInputs) {
        const inpVal = (inp.value || "").trim().toLowerCase();
        const targetVal = val.toLowerCase();
        if (inpVal && (inpVal === targetVal || inpVal.includes(targetVal) || targetVal.includes(inpVal))) {
          const rect = inp.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            entity.boundingBox = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              left: Math.round(rect.left)
            };
            foundBox = true;
            break;
          }
        }
      }
    }
  }

  return { entities: finalEntities, score };
}

