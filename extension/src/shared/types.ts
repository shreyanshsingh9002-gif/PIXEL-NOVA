export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
}

export interface InteractiveElement {
  index: number;
  tag: string;
  text: string;
  ariaLabel: string | null;
  placeholder: string | null;
  type: string | null;
  id: string;
  name: string | null;
  selector: string;
  boundingBox: BoundingBox;
  isVisible: boolean;
  isSensitive?: boolean;
  value?: string;
}

export interface PageInfo {
  title: string;
  url: string;
  text: string;
  interactiveElements: InteractiveElement[];
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
  detectedEntities?: PIIEntity[];
}

export type PIICategory =
  | "EMAIL"
  | "PHONE"
  | "CARD"
  | "AADHAAR"
  | "PAN"
  | "PASSWORD"
  | "SECRET"
  | "NAME"
  | "ADDRESS"
  | "CVV"
  | "CARD_EXPIRY"
  | "OTP"
  | "MEDICAL"
  | "FINANCIAL"
  | "CONFIDENTIAL"
  | "LEGAL";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type DetectionSource = "RULEBOOK" | "ML_EDGE_MODEL" | "HYBRID";

export interface PIIEntity {
  id: string;
  category: PIICategory;
  value: string;
  maskedValue: string;
  risk: RiskLevel;
  boundingBox?: BoundingBox;
  elementIndex?: number;
  selector?: string;
  detectionSource?: DetectionSource;
  confidence?: number;
}

export interface PrivacyScore {
  overallScore: number; // 0 to 100 (100 = completely safe/sanitized)
  totalPIIDetected: number;
  totalRedacted: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  sensitivityScore?: number; // 0 (benign) to 100 (extremely sensitive)
  mlModelName?: string;
  mlInferenceTimeMs?: number;
  hardwareBackend?: "WebGPU" | "WASM";
}

export interface VisualDetectedElement {
  id: string;
  label: "input_field" | "button" | "text_block" | "avatar_face" | "card_container" | "badge";
  confidence: number;
  boundingBox: BoundingBox;
}

export interface LocalVisionResult {
  device: "WebGPU" | "WASM" | "SIMD";
  modelName: string;
  inferenceTimeMs: number;
  elementsDetected: VisualDetectedElement[];
}

export interface PrivacyTelemetryAudit {
  rawPIIDetected: number;
  rawPIITransmitted: number;
  sanitizedEntitiesCount: number;
  blockedTransmissions: number;
  maskedInRamPercent: number;
  bytesSent: number;
  executionProvider: string;
  mlSensitivityScore?: number;
  mlModelActive?: string;
}

export interface SanitizedContext {
  title: string;
  url: string;
  sanitizedText: string;
  safeElements: InteractiveElement[];
  piiEntities: PIIEntity[];
  privacyScore: PrivacyScore;
  isBlocked: boolean;
  blockReason?: string;
  redactedScreenshotUrl?: string;
  rawScreenshotUrl?: string;
  localVision?: LocalVisionResult;
  telemetryAudit?: PrivacyTelemetryAudit;
}

export type AgentActionType =
  | "click"
  | "type"
  | "scroll"
  | "navigate"
  | "wait"
  | "finish"
  | "confirm_action";

export interface AgentAction {
  action: AgentActionType;
  targetIndex?: number;
  selector?: string;
  value?: string;
  direction?: "up" | "down" | "top" | "bottom";
  amount?: number;
  thought: string;
  confidence?: number;
  requiresConfirmation?: boolean;
  warningMessage?: string;
  pressEnter?: boolean;
  targetText?: string;
}

export interface AgentStep {
  stepIndex: number;
  timestamp: number;
  goal: string;
  action: AgentAction;
  status:
    | "observing"
    | "redacting"
    | "planning"
    | "validating"
    | "executing"
    | "completed"
    | "failed"
    | "waiting_user";
  result?: string;
  error?: string;
}

export interface UserVaultProfile {
  fullName: string;
  gender: string;
  dob: string;
  email: string;
  phone: string;
  alternatePhone?: string;
  address: string;
  landmark?: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  company?: string;
  aadhaarMock: string;
  panMock: string;
  drivingLicenseMock?: string;
  passportMock?: string;
}

export interface DeepNavResult {
  found: boolean;
  elementText: string;
  selector: string;
  locationDescription: string;
}

export type ExtensionMessage =
  | { type: "GET_PAGE_INFO" }
  | { type: "PAGE_INFO_RESPONSE"; success: boolean; data?: PageInfo; error?: string }
  | { type: "EXECUTE_ACTION"; action: AgentAction }
  | { type: "ACTION_RESULT"; success: boolean; result?: string; error?: string }
  | { type: "CAPTURE_SCREENSHOT" }
  | { type: "SCREENSHOT_RESPONSE"; success: boolean; dataUrl?: string; error?: string }
  | { type: "HIGHLIGHT_ELEMENT"; index: number }
  | { type: "CLEAR_HIGHLIGHT" }
  | { type: "AUTOFILL_FORM"; profile: UserVaultProfile }
  | { type: "AUTOFILL_RESULT"; success: boolean; filledCount: number; fields: string[] }
  | { type: "DEEP_SEARCH"; query: string }
  | { type: "DEEP_SEARCH_RESULT"; success: boolean; result?: DeepNavResult; error?: string };