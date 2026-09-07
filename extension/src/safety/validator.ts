import { AgentAction, InteractiveElement } from "../shared/types";

export interface SafetyCheckResult {
  isSafe: boolean;
  requiresUserConfirmation: boolean;
  reason?: string;
  sanitizedAction: AgentAction;
}

const CRITICAL_ACTION_PATTERNS = [
  /\bpay\b/i,
  /payment/i,
  /purchase/i,
  /buy\s*now/i,
  /\bbuy\b/i,
  /checkout/i,
  /proceed\s+to\s+buy/i,
  /proceed\s+to\s+checkout/i,
  /place\s*order/i,
  /complete\s*order/i,
  /delete\s*account/i,
  /\bdelete\b/i,
  /\btransfer\b/i,
  /send\s*money/i,
  /confirm\s*payment/i,
  /subscribe/i
];

export function validateActionSafety(
  action: AgentAction,
  elements: InteractiveElement[] = []
): SafetyCheckResult {
  // If finish or wait or scroll, it's safe
  if (action.action === "finish" || action.action === "wait" || action.action === "scroll") {
    return {
      isSafe: true,
      requiresUserConfirmation: false,
      sanitizedAction: action
    };
  }

  // 1. Resolve target element by targetIndex or targetText or selector
  let target: InteractiveElement | undefined = undefined;
  if (typeof action.targetIndex === "number" && elements.length > 0) {
    target = elements.find((e) => e.index === action.targetIndex);
  }
  if (!target && action.targetText && elements.length > 0) {
    const textLower = action.targetText.toLowerCase().trim();
    target = elements.find((e) => {
      const elText = `${e.text} ${e.ariaLabel || ""} ${e.id || ""} ${e.name || ""}`.toLowerCase();
      return elText.includes(textLower) || textLower.includes(e.text.toLowerCase());
    });
  }

  // Safety rule 1: Never let AI interact with unredacted sensitive password or card inputs without confirmation
  if (target?.isSensitive) {
    return {
      isSafe: true,
      requiresUserConfirmation: true,
      reason: `Action targets sensitive element <${target.tag}> [${target.type || "sensitive"}]. User authorization required.`,
      sanitizedAction: {
        ...action,
        requiresConfirmation: true,
        warningMessage: `Agent wants to interact with sensitive field: ${target.name || target.id || target.tag}`
      }
    };
  }

  // Safety rule 2: Check for critical financial, purchase, or irreversible actions
  const candidateTexts = [
    action.targetText || "",
    target?.text || "",
    target?.ariaLabel || "",
    target?.id || "",
    target?.name || "",
    action.thought || ""
  ].join(" ");

  const isCritical = CRITICAL_ACTION_PATTERNS.some((pattern) =>
    pattern.test(candidateTexts)
  );

  if (isCritical) {
    const actionLabel = target?.text || action.targetText || "high-impact action";
    return {
      isSafe: true,
      requiresUserConfirmation: true,
      reason: `Action triggers potentially financial or irreversible action: "${actionLabel}". User confirmation required.`,
      sanitizedAction: {
        ...action,
        requiresConfirmation: true,
        warningMessage: `Critical Action: ${action.action.toUpperCase()} on "${actionLabel}". Do you authorize this transaction/action?`
      }
    };
  }

  return {
    isSafe: true,
    requiresUserConfirmation: false,
    sanitizedAction: action
  };
}

