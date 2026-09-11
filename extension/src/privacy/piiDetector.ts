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

    case "ADDRESS": {
      let norm = clean.toLowerCase()
        .replace(/^(?:delivering|deliver(?:y)?|ship(?:ping)?|send|order\s+to|destination)\s+(?:to|in|at)\s+/i, "")
        .replace(/\b(?:update|change|select)\s+location\b.*$/i, "")
        .trim();
      const pinMatch = norm.match(/\b([1-9][0-9]{5})\b/);
      if (pinMatch) {
        const cleanAlpha = norm.replace(/[^a-z]/g, "").slice(0, 15);
        return `addr_in_${cleanAlpha}_${pinMatch[1]}`;
      }
      return `addr_${norm.replace(/[^a-z0-9]/g, "").slice(0, 35)}`;
    }

    case "UPI":
      return `upi_${clean.toLowerCase()}`;

    case "PASSPORT":
      return `passport_${clean.toUpperCase().replace(/\s+/g, "")}`;

    case "BANK_ACCOUNT":
      return `bank_${clean.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;

    default:
      return `${category.toLowerCase()}_${clean.toLowerCase().replace(/\s+/g, " ")}`;
  }
}

// Verhoeff algorithm multiplication table d for Aadhaar UIDAI verification
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

// Permutation table p
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

export function isValidAadhaar(num: string): boolean {
  const clean = num.replace(/\D/g, "");
  if (clean.length !== 12) return false;
  if (/^(\d)\1{11}$/.test(clean)) return false;
  if (clean[0] === "0" || clean[0] === "1") return false;

  let c = 0;
  const reversed = clean.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    const digit = parseInt(reversed[i], 10);
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digit]];
  }
  return c === 0;
}

// Detection patterns
const PATTERNS: Array<{
  category: PIICategory;
  risk: RiskLevel;
  regex: RegExp;
  validator?: (match: string) => boolean;
}> = [
  // Email addresses (including masked emails like shr**@kiet.edu or j***e@domain.com)
  {
    category: "EMAIL",
    risk: "LOW",
    regex: /\b[A-Za-z0-9._%+*•x-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    validator: (match) => {
      const parts = match.split("@");
      if (parts.length !== 2) return false;
      const [user, domain] = parts;
      if (!/[A-Za-z0-9]/.test(user)) return false;
      if (!domain.includes(".") || domain.length < 4) return false;
      return true;
    }
  },
  // Indian Mobile numbers (+91 or 10-digit, including masked like 98****3210 or 98765*****)
  {
    category: "PHONE",
    risk: "MEDIUM",
    regex: /(?:\+91[-.\s]?)?[6-9][\d*•x]{3,4}[-.\s]?[\d*•x]{4,5}\b/g,
    validator: (match) => {
      const clean = match.replace(/[^0-9*•x]/g, "");
      return clean.length === 10 || (clean.length === 12 && clean.startsWith("91"));
    }
  },
  // Standard International / US Phone numbers (strictly requires valid NANP exchange codes 2-9, rejecting Amazon order IDs like 525-1016217)
  {
    category: "PHONE",
    risk: "MEDIUM",
    regex: /\b(?:\+1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s][2-9]\d{2}[-.\s]\d{4}\b/g
  },
  // Indian Aadhaar Number: 12 digits, often 4-4-4 formatted with Verhoeff Checksum
  {
    category: "AADHAAR",
    risk: "HIGH",
    regex: /(?<!\d[-\s]?)\b[2-9]\d{3}[-\s]?\d{4}[-\s]?\d{4}\b(?![-\s]?\d)/g,
    validator: (match) => {
      return isValidAadhaar(match);
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
    regex: /\b(?:Flat\s+\d+|House\s+No|Plot\s+No|H\.?\s*No|Block\s+[A-Z0-9]+|Sector\s+\d+|Phase\s+\d+|Floor\s+\d+|Apartments?|Palms?|Residency|Vihar|Colony|Enclave|Nagar|Marg|Road|Street|Lane|Avenue)\b[^\n\r<]{8,90}(?:\b[1-9][0-9]{5}\b|\b\d{5}(?:-\d{4})?\b|[A-Za-z]+(?:\s+[A-Za-z]+)?\s+\d{5,6})/gi,
    validator: (val) => {
      const lower = val.toLowerCase().trim();
      return !/\b(?:otp|auth|authentication|authenticat[a-z]*|factor|2fa|verification|code|login|current|order|invoice|tracking|card|pass|pin|valid|minutes|seconds)\b/i.test(lower) && !UI_BRAND_WORDS.has(lower);
    }
  },
  // Labeled Delivery Address (e.g. Delivery Address: Flat 402, Royal Palms ...)
  {
    category: "ADDRESS",
    risk: "MEDIUM",
    regex: /\b(?:delivery\s+|shipping\s+|billing\s+|residential\s+|home\s+)?address\s*[:#-]?\s*([^\n\r<]{12,110})/gi,
    validator: (val) => {
      const lower = val.toLowerCase().trim();
      return !/\b(?:otp|auth|authentication|authenticat[a-z]*|factor|2fa|verification|code|login|current|order|invoice|tracking|card|pass|pin|valid|minutes|seconds)\b/i.test(lower) && !UI_BRAND_WORDS.has(lower);
    }
  },
  // E-Commerce Delivery Location / City / Pincode Header (e.g. Delivering to Ghaziabad 201206)
  {
    category: "ADDRESS",
    risk: "MEDIUM",
    regex: /\b(?:delivering|deliver(?:y)?|ship(?:ping)?|send)\s+(?:to|in|at)\s+([A-Za-z\s,-]{2,35}?\s+\b[1-9][0-9]{5}\b)/gi,
    validator: (val) => {
      const lower = val.toLowerCase().trim();
      return !/\b(?:otp|auth|authentication|authenticat[a-z]*|factor|2fa|verification|code|login|current|order|invoice|tracking|card|pass|pin|valid|minutes|seconds)\b/i.test(lower) && !UI_BRAND_WORDS.has(lower);
    }
  },
  // Indian City + 6-digit Pincode (e.g. Ghaziabad 201206, Noida 201301)
  {
    category: "ADDRESS",
    risk: "MEDIUM",
    regex: /\b([A-Z][a-zA-Z\s]{2,20}\s+\b[1-9][0-9]{5}\b)/g,
    validator: (val) => {
      const lower = val.toLowerCase().trim();
      // CRITICAL: NEVER match OTP codes, auth codes, login headers, or 2FA headings as addresses!
      if (/\b(?:otp|auth|authentication|authenticat[a-z]*|factor|2fa|verification|code|login|current|order|invoice|tracking|card|pass|pin|valid|minutes|seconds)\b/i.test(lower)) {
        return false;
      }
      if (UI_BRAND_WORDS.has(lower)) return false;
      return true;
    }
  },
  // API Keys / Secrets / Tokens
  {
    category: "SECRET",
    risk: "HIGH",
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)\b/g
  },
  // UPI Virtual Payment Address (e.g. rahul@okaxis, 9876543210@paytm, name@upi)
  {
    category: "UPI",
    risk: "HIGH",
    regex: /\b[a-zA-Z0-9.\-_]{2,64}@(okhdfcbank|okaxis|oksbi|okicici|ybl|ibl|axl|paytm|upi|apl|barodampay|pnb|postbank|idfcbank|freecharge|federal|rbl|kotak|sbi|hdfcbank|icici|axisbank)\b/gi
  },
  // Indian Passport Number (1 letter, followed by 7 digits)
  {
    category: "PASSPORT",
    risk: "HIGH",
    regex: /\b[A-PR-WYa-pr-wy][1-9]\d\s?\d{4}[1-9]\b/g,
    validator: (match) => {
      const clean = match.replace(/\s/g, "");
      return clean.length === 8 && /^[A-Za-z][0-9]{7}$/.test(clean);
    }
  },
  // Indian Bank IFSC Code (4 letters, 0, 6 alphanumeric)
  {
    category: "BANK_ACCOUNT",
    risk: "MEDIUM",
    regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g
  }
];

export const UI_BRAND_WORDS = new Set([
  "visa", "visa premium", "mastercard", "rupay", "amex", "american express",
  "discover", "maestro", "diners", "paypal", "google pay", "phonepe", "paytm",
  "two-factor", "2fa", "authentication", "active otp", "current login otp",
  "identity", "kyc", "verification", "sensitive", "verified", "verified kyc",
  "pci protected", "npci", "rbi", "secure", "npci / rbi secure", "saved payment cards",
  "saved upi", "linked bank accounts", "personal profile", "shopping cart",
  "recent orders", "my account", "card holder", "expires", "valid thru",
  "cvv", "cvc", "cid", "ifsc", "ifsc code", "a/c number", "account number",
  "primary upi id", "vpa", "refund bank account", "update kyc details",
  "update kyc", "aadhaar number", "permanent account number", "indian passport number",
  "account password", "delivery address", "phone number", "email address",
  "full name", "recipient full name"
]);

const FALSE_POSITIVE_WORDS = new Set([
  // Legal procedural words
  "issued", "matter", "filed", "pending", "hearing", "notice", "order", "summons",
  "court", "suit", "police", "high", "civil", "criminal", "case", "action", "dispute",
  "record", "litigation", "bench", "tribunal", "session", "judiciary", "justice",
  // Common filler words
  "account", "balance", "number", "payment", "card", "expire", "valid", "total",
  "amount", "order", "status", "delivery", "shipping", "billing", "customer",
  "client", "profile", "password", "security", "code", "digits", "verified"
]);

/**
 * Global entity deduplicator that merges duplicate entity instances,
 * consolidates bounding boxes across DOM occurrences, and assigns clean, unique masked tokens.
 */
export function deduplicateEntities(rawEntities: PIIEntity[]): PIIEntity[] {
  const seenKeys = new Map<string, PIIEntity>();

  for (const ent of rawEntities) {
    if (!ent.value || ent.value.trim().length < 2) continue;

    // Strip trailing action suffixes from container text (e.g. "Delivering to Ghaziabad 201206\nUpdate location" -> "Delivering to Ghaziabad 201206")
    ent.value = ent.value.replace(/\s*(?:\r?\n)+\s*(?:update|change|select)\s+location\b.*$/i, "").trim();

    const valLower = ent.value.trim().toLowerCase();
    // 1. Filter out known false positive common English words
    if (FALSE_POSITIVE_WORDS.has(valLower)) continue;

    // 2. Filter out common UI action button phrases misclassified as ADDRESS or NAME
    const isUIActionPhrase =
      /^(?:update|change|select|choose|enter|set|add|manage|view|edit|see|your)\s+(?:location|address|pincode|zipcode|city|delivery|destination)$/i.test(valLower) ||
      /^(?:update location|change location|select your address|choose your location|select location|add address|manage address|your location|your address)$/i.test(valLower);
    if (isUIActionPhrase) continue;

    // 2B. Filter out OTP codes, auth codes, and 2FA headings falsely categorized as ADDRESS
    if (ent.category === "ADDRESS") {
      if (
        /\b(?:two-factor|2fa|authenticat|active otp|login otp|verification|code is|login code|current login otp)\b/i.test(valLower) ||
        UI_BRAND_WORDS.has(valLower)
      ) {
        continue;
      }
    }

    // 3. Legal case/FIR numbers MUST contain at least one digit
    if (ent.category === "LEGAL" && !/\d/.test(ent.value)) continue;

    const key = getCanonicalEntityKey(ent.category, ent.value);

    if (!seenKeys.has(key)) {
      seenKeys.set(key, { ...ent });
    } else {
      const existing = seenKeys.get(key)!;
      // Merge bounding box if existing didn't have one
      if (!existing.boundingBox && ent.boundingBox) {
        existing.boundingBox = ent.boundingBox;
      } else if (existing.boundingBox && ent.boundingBox) {
        // If this entity appears at a distinct vertical/horizontal screen position, preserve it as a separate visual entity
        const isDiffLocation =
          Math.abs(existing.boundingBox.top - ent.boundingBox.top) > 20 ||
          Math.abs(existing.boundingBox.left - ent.boundingBox.left) > 20;
        if (isDiffLocation) {
          seenKeys.set(`${key}_loc_${ent.boundingBox.top}_${ent.boundingBox.left}`, { ...ent });
        }
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

  // 4. Substring & Spatial Bounding Box Consolidation
  const preliminary = Array.from(seenKeys.values());
  const consolidated: PIIEntity[] = [];

  for (let i = 0; i < preliminary.length; i++) {
    const current = preliminary[i];
    let isRedundant = false;

    for (let j = 0; j < preliminary.length; j++) {
      if (i === j) continue;
      const other = preliminary[j];

      if (current.category === other.category) {
        const currVal = current.value.trim().toLowerCase();
        const otherVal = other.value.trim().toLowerCase();

        // Substring redundancy: If current value is strictly shorter and contained in other
        // e.g. currVal "ghaziabad 201206" is contained in otherVal "delivering to ghaziabad 201206"
        if (currVal.length < otherVal.length && otherVal.includes(currVal)) {
          isRedundant = true;
          if (!other.boundingBox && current.boundingBox) {
            other.boundingBox = current.boundingBox;
          }
          break;
        }

        // Spatial bounding box overlap check
        if (current.boundingBox && other.boundingBox) {
          const b1 = current.boundingBox;
          const b2 = other.boundingBox;
          const xOverlap = Math.max(0, Math.min(b1.left + b1.width, b2.left + b2.width) - Math.max(b1.left, b2.left));
          const yOverlap = Math.max(0, Math.min(b1.top + b1.height, b2.top + b2.height) - Math.max(b1.top, b2.top));
          const overlapArea = xOverlap * yOverlap;
          const minArea = Math.min(b1.width * b1.height, b2.width * b2.height);

          if (minArea > 0 && overlapArea / minArea > 0.5) {
            if (currVal.length <= otherVal.length) {
              isRedundant = true;
              break;
            }
          }
        }
      }
    }

    if (!isRedundant) {
      consolidated.push(current);
    }
  }

  // Re-index masked values cleanly ([EMAIL_1], [PHONE_1], [AADHAAR_1], etc.)
  const categoryCounters: Record<string, number> = {};
  const deduped: PIIEntity[] = [];

  for (const ent of consolidated) {
    const cat = ent.category;
    categoryCounters[cat] = (categoryCounters[cat] || 0) + 1;
    const count = categoryCounters[cat];

    let maskedValue = `[${cat}_${count}]`;
    if (cat === "CVV") maskedValue = "███";
    else if (cat === "OTP") maskedValue = "██████";
    else if (cat === "CARD_EXPIRY") maskedValue = "[CARD_EXPIRY]";
    else if (cat === "ADDRESS") maskedValue = "[REDACTED_LOCATION]";
    else if (cat === "PASSWORD") maskedValue = "████████";
    else if (cat === "NAME") maskedValue = "[REDACTED_NAME]";
    else if (cat === "UPI") maskedValue = "[REDACTED_UPI]";
    else if (cat === "PASSPORT") maskedValue = "[REDACTED_PASSPORT]";
    else if (cat === "BANK_ACCOUNT") maskedValue = "[REDACTED_BANK_AC]";

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
    // OTP in inputs only (Strict: Never match close buttons or modal headers)
    else if (
      (el.tag === "input" || el.tag === "textarea") &&
      (combinedAttrs.includes("otp") || combinedAttrs.includes("one-time-code") || combinedAttrs.includes("verification-code") || combinedAttrs.includes("auth code") || lowerPlaceholder.includes("otp"))
    ) {
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
    // PAN Input fields only (Strict: Never match span, expand, companion, etc.)
    else if (
      (el.tag === "input" || el.tag === "textarea") &&
      /\b(?:pan|pancard|pan-card|pan_card|pan-number|pan_number)\b/i.test(`${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.ariaLabel || ""}`)
    ) {
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
  const vpWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vpHeight = typeof window !== "undefined" ? window.innerHeight : 1080;

  // Viewport-only text extraction: strictly scan visible elements within active viewport
  const visibleTextPieces: string[] = [];
  const textContainers = doc.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6, p, span, div, li, label, button, a, td, th, dt, dd, b, strong, i, em, code, pre, [class*='val' i], [id*='val' i], [class*='card' i], [id*='card' i], [class*='number' i], #glow-ingress-line1, #glow-ingress-line2, [id*='ingress' i], [class*='location' i]"
  );
  for (const el of Array.from(textContainers)) {
    if (el.children.length > 2) continue;
    if (el.closest("footer, #navFooter, .navFooterLine, [role='contentinfo'], .footer, #footer, script, style, noscript")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom > 0 && rect.top < vpHeight && rect.right > 0 && rect.left < vpWidth) {
      const t = (el.innerText || el.textContent || "").trim();
      if (t && t.length >= 2 && !visibleTextPieces.includes(t)) {
        visibleTextPieces.push(t);
      }
    }
  }

  // Only take input values that are within the active viewport and not in footers
  const inputValues = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .filter((inp) => {
      if (inp.closest("footer, #navFooter, .navFooterLine, [role='contentinfo'], .footer, #footer")) return false;
      const rect = inp.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < vpHeight && rect.right > 0 && rect.left < vpWidth;
    })
    .map((i) => (i.value || "").trim())
    .filter(Boolean)
    .join(" ");

  const pageText = visibleTextPieces.length > 0
    ? `${visibleTextPieces.join("\n")}\n${inputValues}`
    : `${(doc.body?.innerText || "").slice(0, 1500).trim()}\n${inputValues}`;

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

    // Strict viewport boundaries: ignore elements outside visible screen!
    if (rect.bottom <= 0 || rect.top >= vpHeight || rect.right <= 0 || rect.left >= vpWidth) return;

    // Exclude footer and corporate copyright info
    if (el.closest("footer, #navFooter, .navFooterLine, [role='contentinfo'], .footer, #footer")) return;

    const minLen = (category === "OTP" || category === "CVV") ? 1 : 2;
    if (!val || val.trim().length < minLen) return;

    // 1. NEVER mask NAME (per user requirement)
    if (category === "NAME") return;

    // 2. NEVER mask UI structure: headings, badges, card headers, labels
    const tag = el.tagName.toUpperCase();
    if (/^(H1|H2|H3|H4|H5|H6|LABEL|TH|THEAD)$/.test(tag)) return;
    if (el.closest("h1, h2, h3, h4, h5, h6, [role='heading'], .badge, .card-header")) return;

    // 3. NEVER mask brand text, card network labels, or common field headers
    const normLower = val.trim().toLowerCase();
    if (UI_BRAND_WORDS.has(normLower)) return;

    // Occlusion check: Never assign coordinates to an element if it is occluded beneath an active modal dialog
    if (typeof doc !== "undefined" && typeof doc.elementFromPoint === "function") {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx >= 0 && cx < window.innerWidth && cy >= 0 && cy < window.innerHeight) {
        try {
          const topEl = doc.elementFromPoint(cx, cy);
          if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
            const modal = topEl.closest<HTMLElement>(
              'dialog[open], [role="dialog"], [aria-modal="true"], .modal, .modal-dialog, .swal2-container, .popup-container, .overlay, [class*="modal" i], [class*="dialog" i], [class*="popup" i]'
            );
            if (modal && !modal.contains(el)) {
              return; // Occluded beneath modal: ignore ghost bounding box!
            }
          }
        } catch {}
      }
    }

    // Strict boundary: Never let a single text entity adopt the dimensions of a massive page container!
    const boundedW = Math.min(rect.width, 480);
    const boundedH = Math.min(rect.height, 60);

    const safeBox: BoundingBox = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(boundedW),
      height: Math.round(boundedH),
      top: Math.round(rect.top),
      left: Math.round(rect.left)
    };

    const key = getCanonicalEntityKey(category, val);
    const existing = entities.find(
      (e) => getCanonicalEntityKey(e.category, e.value) === key
    );
    if (existing) {
      if (!existing.boundingBox) {
        existing.boundingBox = safeBox;
      } else {
        // If this is a distinct visual location on screen (e.g. cardholder name on card vs profile), add separate box
        const isDiffLocation =
          Math.abs(existing.boundingBox.top - safeBox.top) > 20 ||
          Math.abs(existing.boundingBox.left - safeBox.left) > 20;
        if (isDiffLocation) {
          entityCounter++;
          entities.push({
            id: `pii_${category.toLowerCase()}_dom_${entityCounter}`,
            category,
            value: val,
            maskedValue,
            risk,
            boundingBox: safeBox
          });
        }
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
        boundingBox: safeBox
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
    // UPI / VPA ID
    else if ((combined.includes("upi") || combined.includes("vpa")) && val.length >= 4) {
      helperAddEntityWithBox("UPI", val, `[REDACTED_UPI]`, "HIGH", inp);
    }
    // Passport
    else if (combined.includes("passport") && val.length >= 6) {
      helperAddEntityWithBox("PASSPORT", val, `[REDACTED_PASSPORT]`, "HIGH", inp);
    }
    // Bank Account / IFSC
    else if ((combined.includes("ifsc") || combined.includes("bank_acc") || combined.includes("account_no")) && val.length >= 4) {
      helperAddEntityWithBox("BANK_ACCOUNT", val, `[REDACTED_BANK_AC]`, "HIGH", inp);
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

  // 6. Address / City / Pincode elements in static DOM (e.g. #val-address, #val-city, or e-commerce delivery locations)
  const addrEls = doc.querySelectorAll<HTMLElement>(
    "#glow-ingress-line2, #glow-ingress-line1, [id*='location-slot' i], [class*='delivery-location' i], [id*='address' i], [class*='address' i], [id*='city' i], [class*='city' i], [id*='pincode' i], [class*='pincode' i]"
  );
  addrEls.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    if (el.closest("footer, #navFooter, .navFooterLine, [role='contentinfo'], .footer, #footer")) return;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "search" || role === "searchbox" || el.closest("form[role='search'], [role='search']")) return;

    // Reject substring collisions (e.g. "velocity" on Amazon, "opacity-100", "capacity", "electricity", etc.)
    const id = (el.id || "").toLowerCase();
    const cls = (el.className || "").toString().toLowerCase();

    const isEcomLocation =
      id === "glow-ingress-line2" ||
      id === "glow-ingress-line1" ||
      /\b(?:ingress|delivery-location|location-slot)\b/i.test(`${id} ${cls}`);

    const isRealAddressIdentifier =
      isEcomLocation ||
      /\b(?:address|street|delivery-address|shipping-address|pincode|zipcode|postal-code)\b/i.test(`${id} ${cls}`) ||
      /\bcity\b/i.test(`${id} ${cls}`);

    if (!isRealAddressIdentifier) return;

    // Skip parent wrappers containing multiple children so we only target leaf text
    if (el.children.length > 2 && !isEcomLocation) return;

    // Reject giant layout containers (e.g. #address-book-wrapper, #nav-global-location-slot)
    const rect = el.getBoundingClientRect();
    if (rect.width > 500 || rect.height > 100 || rect.width <= 0 || rect.height <= 0) return;

    let val = (el.innerText || (el as HTMLInputElement).value || "").trim();
    // Strip trailing action suffixes
    val = val.replace(/\s*(?:\r?\n)+\s*(?:update|change|select)\s+location\b.*$/i, "").trim();

    if (val.length >= 3 && val.length <= 150) {
      // Reject pure UI action phrases (e.g. "Update location", "Select your address")
      if (
        /^(?:update|change|select|choose|enter|set|add|manage|view|edit|see|your)\s+(?:location|address|pincode|zipcode|city|delivery|destination)$/i.test(val) ||
        /^(?:update location|change location|select your address|choose your location|select location|add address|manage address)$/i.test(val)
      ) {
        return;
      }

      // For e-commerce delivery elements, verify it actually contains physical location content
      if (isEcomLocation) {
        const hasPinOrDigits = /\b[1-9][0-9]{5}\b|\b\d{5}\b/.test(val);
        const hasLocationWords = /\b(?:to|in|at)\s+[A-Za-z]/i.test(val) || /\b[A-Z][a-z]+/.test(val);
        if (!hasPinOrDigits && !hasLocationWords) return;
      }

      helperAddEntityWithBox("ADDRESS", val, "[REDACTED_LOCATION]", "MEDIUM", el);
    }
  });

  // 7. OTP elements (e.g. #val-otp, .otp-val, .auth-code)
  const otpEls = doc.querySelectorAll<HTMLElement>("[id*='val-otp' i], [class*='otp-val' i], [id*='otp-code' i], [class*='otp-code' i]");
  otpEls.forEach((el) => {
    const val = (el.innerText || (el as HTMLInputElement).value || "").trim();
    if (/^\d{4,8}$/.test(val)) {
      helperAddEntityWithBox("OTP", val, "██████", "HIGH", el);
    }
  });

  // 7B. Segmented OTP input boxes (e.g. 4 to 8 single-character inputs in an OTP modal or row)
  const singleCharInputs = Array.from(doc.querySelectorAll<HTMLInputElement>(
    "input[maxlength='1'], input[size='1'], input[type='tel'][maxlength='1'], input[pattern*='0-9']"
  ));
  if (singleCharInputs.length >= 4 && singleCharInputs.length <= 8) {
    singleCharInputs.forEach((inp) => {
      const val = (inp.value || "").trim() || "•";
      helperAddEntityWithBox("OTP", val, "█", "HIGH", inp);
    });
  } else {
    const otpContainers = doc.querySelectorAll<HTMLElement>(
      "[class*='otp-row' i], [id*='otp-row' i], [class*='otp-input' i], [class*='code-inputs' i]"
    );
    otpContainers.forEach((container) => {
      const inputs = container.querySelectorAll<HTMLInputElement>("input");
      if (inputs.length >= 4 && inputs.length <= 8) {
        inputs.forEach((inp) => {
          const val = (inp.value || "").trim() || "•";
          helperAddEntityWithBox("OTP", val, "█", "HIGH", inp);
        });
      }
    });
  }

  // 8. UPI elements in static DOM (e.g. #val-upi or .upi-val)
  const upiEls = doc.querySelectorAll<HTMLElement>("[id*='upi' i], [class*='upi' i], [id*='vpa' i]");
  upiEls.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const val = (el.innerText || "").trim();
    if (/[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,64}/.test(val)) {
      helperAddEntityWithBox("UPI", val, "[REDACTED_UPI]", "HIGH", el);
    }
  });

  // 9. Bank Account & IFSC elements in static DOM
  const bankEls = doc.querySelectorAll<HTMLElement>("[id*='ifsc' i], [class*='ifsc' i], [id*='bank-ac' i], [class*='bank-ac' i], [id*='account-num' i]");
  bankEls.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const val = (el.innerText || "").trim();
    if (/\b[A-Z]{4}0[A-Z0-9]{6}\b/.test(val)) {
      helperAddEntityWithBox("BANK_ACCOUNT", val, "[REDACTED_IFSC]", "MEDIUM", el);
    } else if (/\b\d{9,18}\b/.test(val)) {
      helperAddEntityWithBox("BANK_ACCOUNT", val, "[REDACTED_BANK_AC]", "HIGH", el);
    }
  });

  // 10. Passport elements in static DOM (e.g. #val-passport)
  const passEls = doc.querySelectorAll<HTMLElement>("[id*='passport' i], [class*='passport' i]");
  passEls.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const val = (el.innerText || "").trim();
    if (/^[A-PR-WYa-pr-wy][1-9]\d\s?\d{4}[1-9]$/.test(val)) {
      helperAddEntityWithBox("PASSPORT", val, "[REDACTED_PASSPORT]", "HIGH", el);
    }
  });

  // 11. Credit / Debit Card elements in static DOM (e.g. .cc-number, #val-card-num)
  const cardCandidates = doc.querySelectorAll<HTMLElement>(
    ".cc-number, .card-number, .card-num, [id*='card-num' i], [id*='card_num' i], [class*='card-num' i], [class*='cc-num' i], [class*='cc_num' i]"
  );
  cardCandidates.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    if (el.children.length > 1) return;
    const val = (el.innerText || el.textContent || "").trim();
    const digits = val.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && isValidLuhn(digits)) {
      helperAddEntityWithBox("CARD", val, "[REDACTED_CARD]", "HIGH", el);
    }
  });

  // 13. Aadhaar / UIDAI in static DOM (e.g. #val-aadhaar, .aadhaar-val)
  const aadhaarCandidates = doc.querySelectorAll<HTMLElement>(
    "[id*='aadhaar' i], [class*='aadhaar' i], [id*='aadhar' i], [class*='aadhar' i], [id*='uidai' i], [class*='uidai' i]"
  );
  aadhaarCandidates.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    if (el.children.length > 1) return;
    const val = (el.innerText || el.textContent || "").trim();
    const digits = val.replace(/\D/g, "");
    if (digits.length === 12 && isValidAadhaar(digits)) {
      helperAddEntityWithBox("AADHAAR", val, "[REDACTED_AADHAAR]", "HIGH", el);
    }
  });

  // 14. PAN Card in static DOM (e.g. #val-pan, .pan-val)
  const panCandidates = doc.querySelectorAll<HTMLElement>(
    "[id*='pan' i], [class*='pan' i]"
  );
  panCandidates.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    if (el.children.length > 1) return;
    const val = (el.innerText || el.textContent || "").trim();
    if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(val.replace(/\s+/g, ""))) {
      helperAddEntityWithBox("PAN", val, "[REDACTED_PAN]", "HIGH", el);
    }
  });

  // 15. Masked Passwords in static DOM (e.g. #val-password, ••••••••••••)
  const passValCandidates = doc.querySelectorAll<HTMLElement>(
    "[id*='val-pass' i], [id*='password' i], [class*='password' i]"
  );
  passValCandidates.forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const val = (el.innerText || el.textContent || "").trim();
    if (/^[•*●x█]{4,}$/.test(val) || val.includes("••••")) {
      helperAddEntityWithBox("PASSWORD", val, "████████", "HIGH", el);
    }
  });

  // 16. Contextual ML Data (Salary / CTC & Judicial / FIR Litigation)
  const mlDossierCandidates = doc.querySelectorAll<HTMLElement>(
    "[class*='dossier' i] *, [class*='unstructured' i] *, [style*='border-left']"
  );
  mlDossierCandidates.forEach((el) => {
    if (el.children.length > 1) return;
    const val = (el.innerText || el.textContent || "").trim();
    if (/\b(?:CTC|LPA|salary|annual\s+CTC|ESOPs?)\b/i.test(val) && /\d+/.test(val)) {
      helperAddEntityWithBox("FINANCIAL", val, "[REDACTED_COMPENSATION]", "HIGH", el);
    } else if (/\b(?:FIR|court\s+summons|civil\s+suit|litigation)\b/i.test(val) && /\d+/.test(val)) {
      helperAddEntityWithBox("LEGAL", val, "[REDACTED_LEGAL_CASE]", "HIGH", el);
    }
  });

  // 17. Universal Leaf Text Scanner: checks all visible leaf elements for Credit Cards, Aadhaar, and PAN
  const allLeafElements = doc.querySelectorAll<HTMLElement>("div, span, p, td, b, strong, code");
  for (const el of Array.from(allLeafElements)) {
    if (el.children.length > 0) continue;
    if (el.closest("footer, #navFooter, .navFooterLine, [role='contentinfo'], .footer, #footer, script, style, noscript")) continue;
    const val = (el.innerText || el.textContent || "").trim();
    if (!val || val.length < 8 || val.length > 80) continue;

    // Credit Card Check
    const cardMatch = val.match(/\b(?:\d{4}[-\s]?){3}\d{4}\b|\b(?:\d{4}[-\s]?){2}\d{4}[-\s]?\d{3}\b/);
    if (cardMatch) {
      const digits = cardMatch[0].replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && (isValidLuhn(digits) || /^(?:4\d{15}|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12})$/.test(digits))) {
        helperAddEntityWithBox("CARD", cardMatch[0], "[REDACTED_CARD]", "HIGH", el);
      }
    }

    // Aadhaar Check
    const aadhaarMatch = val.match(/\b[2-9]\d{3}[-\s]?\d{4}[-\s]?\d{4}\b/);
    if (aadhaarMatch) {
      const digits = aadhaarMatch[0].replace(/\D/g, "");
      if (digits.length === 12 && isValidAadhaar(digits)) {
        helperAddEntityWithBox("AADHAAR", aadhaarMatch[0], "[REDACTED_AADHAAR]", "HIGH", el);
      }
    }

    // PAN Check
    const panMatch = val.match(/\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/);
    if (panMatch) {
      helperAddEntityWithBox("PAN", panMatch[0], "[REDACTED_PAN]", "HIGH", el);
    }

    // Delivery Location & Address Check (e.g. "Delivering to Ghaziabad 201206", "Ghaziabad 201206", "Noida 201301")
    const addrMatch = val.match(/\b(?:delivering|deliver(?:y)?|ship(?:ping)?|send)\s+(?:to|in|at)\s+([A-Za-z\s,-]{2,35}?\s+\b[1-9][0-9]{5}\b)/i) ||
                      val.match(/\b([A-Z][a-zA-Z\s]{2,20}\s+\b[1-9][0-9]{5}\b)/);
    if (addrMatch) {
      const matchText = (addrMatch[1] || addrMatch[0]).trim();
      const lower = matchText.toLowerCase();
      const isAction = /^(?:update|change|select|choose|enter|set|add|manage|view|edit|see|your)\s+(?:location|address|pincode|zipcode|city|delivery|destination)$/i.test(lower);
      const isAuthOrBrand = /\b(?:otp|auth|authentication|authenticat[a-z]*|factor|2fa|verification|code|login|current|order|invoice|tracking|card|pass|pin|valid|minutes|seconds)\b/i.test(lower) || UI_BRAND_WORDS.has(lower);
      if (!isAction && !isAuthOrBrand) {
        helperAddEntityWithBox("ADDRESS", matchText, "[REDACTED_LOCATION]", "MEDIUM", el);
      }
    }
  }

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

    // Exemption guard: NEVER assign bounding box to NAME or UI headers
    if (entity.category === "NAME") continue;
    const val = entity.value;
    if (!val || val.length < 2) continue;

    const valLower = val.toLowerCase().trim();
    if (UI_BRAND_WORDS.has(valLower) || /\b(?:two-factor|2fa|authentication|active otp)\b/i.test(valLower)) continue;
    if (entity.category === "ADDRESS" && /\b(?:otp|auth|factor|2fa|verification|code|login)\b/i.test(valLower)) continue;

    let foundBox = false;

    // Search text nodes via DOM Range
    for (const textNode of textNodes) {
      const parentEl = textNode.parentElement;
      if (parentEl) {
        const tag = parentEl.tagName.toUpperCase();
        if (/^(H1|H2|H3|H4|H5|H6|LABEL|TH|THEAD)$/.test(tag)) continue;
        if (parentEl.closest("h1, h2, h3, h4, h5, h6, [role='heading'], .badge, .card-header")) continue;
        if (UI_BRAND_WORDS.has((parentEl.textContent || "").trim().toLowerCase())) continue;
      }

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

    // Fallback 1: search enclosing DOM elements (leaf elements ONLY, excluding headings and containers)
    if (!foundBox) {
      const allElements = doc.querySelectorAll<HTMLElement>("p, span, div, td, th, li, strong, b, code");
      for (const el of allElements) {
        const tag = el.tagName.toUpperCase();
        if (/^(H1|H2|H3|H4|H5|H6|LABEL|TH|THEAD)$/.test(tag)) continue;
        if (el.closest("h1, h2, h3, h4, h5, h6, [role='heading'], .badge, .card-header")) continue;
        if (UI_BRAND_WORDS.has((el.innerText || "").trim().toLowerCase())) continue;
        if (el.children.length > 0) continue; // Pure leaf elements only!

        if ((el.innerText || "").toLowerCase().includes(val.toLowerCase())) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // Strict bound: Never assign layout container dimensions to a text match
            const boundedW = Math.min(rect.width, 480);
            const boundedH = Math.min(rect.height, 60);
            entity.boundingBox = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(boundedW),
              height: Math.round(boundedH),
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
        if (inpVal.length >= 3 && targetVal.length >= 3 && (inpVal === targetVal || inpVal.includes(targetVal) || targetVal.includes(inpVal))) {
          const rect = inp.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const boundedW = Math.min(rect.width, 480);
            const boundedH = Math.min(rect.height, 60);
            entity.boundingBox = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(boundedW),
              height: Math.round(boundedH),
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

  // Strict Viewport Filter: Ensure ONLY entities visible on the user's screen are returned
  const viewportEntities = finalEntities.filter((e) => {
    if (!e.boundingBox) return false;
    const { top, left, width, height } = e.boundingBox;
    if (width <= 0 || height <= 0) return false;
    const bottom = top + height;
    const right = left + width;
    return bottom > 0 && top < vpHeight && right > 0 && left < vpWidth;
  });

  const deduplicatedViewport = deduplicateEntities(viewportEntities);
  score.overallScore = 100;
  score.totalPIIDetected = deduplicatedViewport.length;
  score.totalRedacted = deduplicatedViewport.length;
  score.highRiskCount = deduplicatedViewport.filter((e) => e.risk === "HIGH").length;
  score.mediumRiskCount = deduplicatedViewport.filter((e) => e.risk === "MEDIUM").length;
  score.lowRiskCount = deduplicatedViewport.filter((e) => e.risk === "LOW").length;

  return { entities: deduplicatedViewport, score };
}

