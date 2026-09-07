import {
  PIIEntity,
  InteractiveElement,
  PageInfo,
  SanitizedContext,
  PrivacyScore
} from "../shared/types";

/**
 * Replaces all occurrences of detected PII text with anonymous semantic tokens.
 */
export function redactText(rawText: string, entities: PIIEntity[]): string {
  let sanitized = rawText;
  // Sort entities by descending length so substrings don't mess up longer tokens
  const sorted = [...entities].sort((a, b) => b.value.length - a.value.length);

  for (const entity of sorted) {
    if (!entity.value || entity.value.length < 2) continue;
    // Escape regex special chars
    const escaped = entity.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    sanitized = sanitized.replace(regex, entity.maskedValue);
  }

  return sanitized;
}

/**
 * Redacts interactive elements so sensitive inputs (e.g. password fields)
 * do not expose values or secrets to remote AI.
 */
export function sanitizeElements(
  elements: InteractiveElement[],
  entities: PIIEntity[]
): InteractiveElement[] {
  return elements.map((el) => {
    const isSensitive =
      el.isSensitive ||
      entities.some((e) => e.elementIndex === el.index);

    if (isSensitive) {
      return {
        ...el,
        text: "[SENSITIVE_FIELD]",
        placeholder: el.placeholder ? "[REDACTED_INPUT]" : null,
        value: undefined,
        isSensitive: true
      };
    }

    // Also sanitize any PII that might appear inside button/link text or aria-labels
    return {
      ...el,
      text: redactText(el.text, entities),
      ariaLabel: el.ariaLabel ? redactText(el.ariaLabel, entities) : null,
      placeholder: el.placeholder ? redactText(el.placeholder, entities) : null
    };
  });
}

/**
 * On-device Visual Canvas Redaction.
 * Takes a raw screenshot base64 data URI and paints solid blackout bars
 * over every detected sensitive bounding box.
 */
export async function redactVisualScreenshot(
  rawScreenshotUrl: string,
  entities: PIIEntity[],
  tabViewportWidth: number = 0,
  devicePixelRatio: number = 1
): Promise<string> {
  if (!rawScreenshotUrl) return "";

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        // FAIL-CLOSED: Never fall back to transmitting raw unredacted screenshots
        console.error("[PIXEL NOVA Security Gate] Canvas 2D context unavailable. Fail-closed: blocking visual screenshot.");
        reject(new Error("PRIVACY_GATE_FAIL_CLOSED: Canvas context unavailable. Raw screenshot blocked."));
        return;
      }

      // 1. Draw original raw screenshot
      ctx.drawImage(img, 0, 0);

      // 2. Accurate scaling calculation
      // Chrome captures at physical pixel resolution (tabViewportWidth * DPR)
      let scale = 1;
      if (tabViewportWidth > 0 && img.width > 0) {
        scale = img.width / tabViewportWidth;
      } else if (devicePixelRatio > 0) {
        scale = devicePixelRatio;
      }

      let maskedCount = 0;

      // 3. Mask sensitive bounding boxes with intelligent clustering and anti-collision
      interface ScaledBox {
        x: number;
        y: number;
        w: number;
        h: number;
        categories: Set<string>;
        hasML: boolean;
        isHighRisk: boolean;
      }

      // Convert raw bounding boxes to canvas scale with small padding
      const initialBoxes: ScaledBox[] = [];
      for (const entity of entities) {
        if (!entity.boundingBox) continue;
        const { x, y, width, height } = entity.boundingBox;
        if (width <= 0 || height <= 0) continue;

        initialBoxes.push({
          x: x * scale - 2,
          y: y * scale - 2,
          w: width * scale + 4,
          h: height * scale + 4,
          categories: new Set([entity.category || "PII"]),
          hasML: entity.detectionSource === "ML_EDGE_MODEL",
          isHighRisk: entity.risk === "HIGH"
        });
      }

      // Merge overlapping or immediately adjacent bounding boxes (Union algorithm)
      const mergedBoxes: ScaledBox[] = [];
      const PADDING_THRESHOLD = 5; // pixels gap to merge closely clustered fields

      for (const box of initialBoxes) {
        let merged = false;
        for (const target of mergedBoxes) {
          // Check collision or close proximity
          const xOverlap = box.x < target.x + target.w + PADDING_THRESHOLD && box.x + box.w + PADDING_THRESHOLD > target.x;
          const yOverlap = box.y < target.y + target.h + PADDING_THRESHOLD && box.y + box.h + PADDING_THRESHOLD > target.y;

          if (xOverlap && yOverlap) {
            // Compute bounding box union
            const minX = Math.min(box.x, target.x);
            const minY = Math.min(box.y, target.y);
            const maxX = Math.max(box.x + box.w, target.x + target.w);
            const maxY = Math.max(box.y + box.h, target.y + target.h);

            target.x = minX;
            target.y = minY;
            target.w = maxX - minX;
            target.h = maxY - minY;
            box.categories.forEach((c) => target.categories.add(c));
            target.hasML = target.hasML || box.hasML;
            target.isHighRisk = target.isHighRisk || box.isHighRisk;

            merged = true;
            break;
          }
        }
        if (!merged) {
          mergedBoxes.push(box);
        }
      }

      // 4. Render sleek, non-overlapping blackout boxes
      for (const box of mergedBoxes) {
        const { x: bx, y: by, w: bw, h: bh, categories, hasML } = box;

        // Option 1: Frosted Slate & Cyber Emerald (Eye-soothing enterprise privacy seal)
        // Primary theme: Soft emerald security border, calm mint text, frosted dark slate fill
        let borderColor = "#10b981"; // Soft Emerald
        let textColor = "#6ee7b7";   // Mint Green
        let bgColor = "#0f172a";     // Deep Frosted Slate (not harsh pitch black)

        // Subtle category variations while preserving the eye-soothing emerald/cyan tone:
        if (categories.has("MEDICAL")) {
          borderColor = "#38bdf8"; // Soft Sky Blue
          textColor = "#7dd3fc";
          bgColor = "#0b192c";
        } else if (categories.has("FINANCIAL") || categories.has("CREDIT_CARD") || categories.has("CVV")) {
          borderColor = "#10b981"; // Emerald Gold/Mint
          textColor = "#34d399";
          bgColor = "#091e1c";
        } else if (categories.has("CONFIDENTIAL") || categories.has("API_KEY") || categories.has("SECRET")) {
          borderColor = "#818cf8"; // Soft Periwinkle
          textColor = "#a5b4fc";
          bgColor = "#111827";
        }

        // A. Draw rounded rectangle background (softer, eye-friendly corners)
        const radius = Math.min(4, Math.min(bw / 4, bh / 4));
        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(bx, by, bw, bh, radius);
        } else {
          ctx.rect(bx, by, bw, bh);
        }
        ctx.fillStyle = bgColor;
        ctx.fill();

        // B. Draw refined hairline security border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // C. Calculate adaptive label fitting without bleeding/overflow
        const primaryCat = Array.from(categories)[0] || "PII";
        const mlBadge = hasML ? " [ML]" : "";

        // Formulate label candidates based on available box width
        let labelText = `🔒 [SHIELDED: ${primaryCat}${mlBadge}]`;
        if (bw < 60) {
          // Extremely small box (e.g. CVV, short zip code)
          labelText = `🔒 ${primaryCat.slice(0, 3)}`;
        } else if (bw < 110) {
          // Compact box (e.g. Expiry Date, PIN)
          labelText = `🔒 [${primaryCat}${mlBadge}]`;
        } else if (bw < 160) {
          // Medium box
          labelText = `🔒 [MASKED: ${primaryCat}${mlBadge}]`;
        }

        // Font sizing calibrated to box height
        const fontSize = Math.max(9, Math.min(12, Math.round(Math.min(bh * 0.55, 11 * scale))));
        ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace`;

        // D. Use Canvas Clipping Mask to guarantee text NEVER leaks outside the box boundary
        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(bx + 1, by + 1, Math.max(0, bw - 2), Math.max(0, bh - 2), Math.max(0, radius - 1));
        } else {
          ctx.rect(bx + 1, by + 1, Math.max(0, bw - 2), Math.max(0, bh - 2));
        }
        ctx.clip();

        // Render text label inside clipped boundary
        ctx.fillStyle = textColor;
        const textY = by + (bh / 2) + (fontSize * 0.35);
        ctx.fillText(labelText, bx + 6, textY);
        ctx.restore();

        maskedCount++;
      }

      // 4. Draw top-right verification badge on sanitized screenshot
      if (entities.length > 0) {
        const hasML = entities.some((e) => e.detectionSource === "ML_EDGE_MODEL");
        const badgeText = hasML
          ? `PIXEL NOVA: ${entities.length} PII SHIELDED (RULEBOOK + ML WEBGPU)`
          : `PIXEL NOVA: ${entities.length} PII REDACTED ON-DEVICE`;
        const bFontSize = Math.max(12, Math.round(13 * (scale > 1.2 ? 1.2 : 1)));
        ctx.font = `bold ${bFontSize}px sans-serif`;
        const textWidth = ctx.measureText(badgeText).width;
        
        const badgeX = canvas.width - textWidth - 24;
        const badgeY = 16;
        const badgeW = textWidth + 16;
        const badgeH = bFontSize + 14;

        // Badge background
        ctx.fillStyle = "rgba(3, 7, 18, 0.88)";
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);

        // Badge border
        ctx.strokeStyle = "#10b981"; // Emerald green
        ctx.lineWidth = 2;
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

        // Badge text
        ctx.fillStyle = "#34d399";
        ctx.fillText(badgeText, badgeX + 8, badgeY + bFontSize + 2);
      }

      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };

    img.onerror = () => {
      // FAIL-CLOSED: Never resolve raw screenshot on error!
      console.error("[PIXEL NOVA Security Gate] Screenshot render failed. Fail-closed: blocking visual screenshot.");
      reject(new Error("PRIVACY_GATE_FAIL_CLOSED: Screenshot load failed. Raw screenshot blocked."));
    };

    img.src = rawScreenshotUrl;
  });
}

