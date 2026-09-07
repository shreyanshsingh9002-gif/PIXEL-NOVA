import { SanitizedContext, PIIEntity, PrivacyScore } from "../shared/types";

export type PrivacyMode = "STRICT" | "BALANCED" | "PERMISSIVE";

export interface GateEvaluation {
  isSafe: boolean;
  blockReason?: string;
  recommendedAction: "PROCEED" | "BLOCK" | "REQUIRE_USER_REVIEW";
}

export function evaluatePrivacyGate(
  sanitizedText: string,
  entities: PIIEntity[],
  score: PrivacyScore,
  mode: PrivacyMode = "BALANCED"
): GateEvaluation {
  // Fail-Closed Check 1: Check if raw unmasked passwords or credentials leaked into sanitized text
  const unmaskedSecretRegex = /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z-_]{35})\b/;
  if (unmaskedSecretRegex.test(sanitizedText)) {
    return {
      isSafe: false,
      blockReason: "CRITICAL: Live unmasked API Key or Secret detected in sanitized payload. Transmission blocked.",
      recommendedAction: "BLOCK"
    };
  }

  // Fail-Closed Check 2: Strict mode blocks if high risk entities were present on screen
  if (mode === "STRICT" && score.highRiskCount > 0) {
    return {
      isSafe: false,
      blockReason: `STRICT MODE: ${score.highRiskCount} high-risk sensitive entities (Pass/Card/Aadhaar) present on page.`,
      recommendedAction: "REQUIRE_USER_REVIEW"
    };
  }

  // Check 3: Balanced mode verifies that every detected entity was tokenized
  const allMasked = entities.every((e) => !sanitizedText.includes(e.value));
  if (!allMasked) {
    return {
      isSafe: false,
      blockReason: "FAIL-CLOSED: Residual unmasked PII string detected in sanitized payload.",
      recommendedAction: "BLOCK"
    };
  }

  return {
    isSafe: true,
    recommendedAction: "PROCEED"
  };
}

