import os
import sys
import json
import re
import time
import urllib.request
import urllib.error
from dotenv import load_dotenv
from typing import Optional
from app.schemas import PlanRequest, PlanResponse

# Ensure Windows console supports utf-8 safely
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

load_dotenv()

# Inference Provider Configuration
# Supported: "gemini", "vllm" (e.g. Qwen2.5-VL, Qwen3-VL, Qwen3.8-Flash, Llama 3.2 Vision), "ollama"
VLM_PROVIDER = (os.getenv("VLM_PROVIDER") or "gemini").strip().lower()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# OpenAI-compatible endpoint settings (vLLM / Ollama / Local Cloud GPU)
OPENAI_COMPATIBLE_BASE_URL = (os.getenv("OPENAI_COMPATIBLE_BASE_URL") or "http://localhost:8000/v1").rstrip("/")
OPENAI_COMPATIBLE_MODEL = os.getenv("OPENAI_COMPATIBLE_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct")
OPENAI_COMPATIBLE_API_KEY = os.getenv("OPENAI_COMPATIBLE_API_KEY", "EMPTY")


def get_api_key() -> str:
    """Strictly fetch key from environment variable, avoiding any hardcoded secrets."""
    return (os.getenv("GEMINI_API_KEY") or "").strip()




def extract_query_from_goal(goal: str) -> str:
    """
    Extracts the intended search query from natural language commands:
      'search for Gaming Laptop'   -> 'Gaming Laptop'
      'find iphone 16 on amazon'   -> 'iphone 16'
      'type hello world into input'-> 'hello world'
    """
    g = goal.strip()
    m = re.search(
        r"(?:search(?:\s+for)?|find|type|look(?:\s+for)?|query)\s+['\"]?([^'\"]+?)['\"]?"
        r"(?:\s+(?:in|on|into|at|using)\b.*)?$",
        g,
        re.IGNORECASE,
    )
    if m:
        extracted = m.group(1).strip()
        cleaned = re.sub(
            r"\s+(?:in|on|into|at|using)\s+.*$", "", extracted, flags=re.IGNORECASE
        ).strip()
        if cleaned:
            return cleaned
    return g


def _call_gemini_with_retry(url: str, payload: dict, max_retries: int = 3) -> dict:
    """
    Makes a Gemini REST call with exponential backoff on 429 rate-limit errors.
    Raises urllib.error.HTTPError for non-retryable failures.
    """
    req_data = json.dumps(payload).encode("utf-8")
    backoff = 2  # seconds

    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={"Content-Type": "application/json"},
            )
            res = urllib.request.urlopen(req, timeout=20)
            return json.loads(res.read().decode("utf-8"))

        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = backoff * (2 ** attempt)
                print(f"[PIXEL NOVA] Gemini 429 rate limit, retrying in {wait}s (attempt {attempt+1}/{max_retries})")
                time.sleep(wait)
                continue
            raise  # Non-429 errors propagate immediately

    raise RuntimeError(f"Gemini API still rate-limited after {max_retries} retries")


def _call_openai_compatible_vlm(payload: dict) -> dict:
    """
    Calls an OpenAI-compatible vision endpoint (vLLM, Ollama, TGI)
    hosting open-weights models like Qwen2.5-VL, Qwen3-VL, Qwen3.8-Flash, or Llama 3.2 Vision.
    """
    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OPENAI_COMPATIBLE_BASE_URL}/chat/completions",
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_COMPATIBLE_API_KEY}"
        },
    )
    res = urllib.request.urlopen(req, timeout=30)
    return json.loads(res.read().decode("utf-8"))


async def plan_action(request: PlanRequest) -> PlanResponse:
    """
    Reason over the sanitized context to generate the next autonomous browser action.
    Primary: Gemini REST API or self-hosted vLLM/Ollama (Qwen-VL / Llama 3.2).
    Fallback: Offline semantic keyword planner.
    """
    gemini_key = get_api_key()


    if gemini_key:
        try:
            # Build element descriptions (de-duped, prioritize high-value elements, up to 60)
            seen = set()
            elements_desc = []
            sorted_elements = sorted(
                request.safeElements[:120],
                key=lambda el: 0 if el.tag in ["button", "input", "select"] or "btn" in (el.selector or "").lower() else 1
            )
            for el in sorted_elements:
                label = (el.text or el.ariaLabel or el.placeholder or el.id or el.name or "(unlabeled)")
                clean_label = label.replace("\n", " ").strip()[:90]
                line = f"[{el.index}] <{el.tag}> '{clean_label}' (selector: {el.selector})"
                if line not in seen:
                    seen.add(line)
                    elements_desc.append(line)
                if len(elements_desc) >= 60:
                    break

            dynamic_query = extract_query_from_goal(request.goal)

            prompt = f"""You are PIXEL NOVA's Remote Brain — a privacy-first autonomous browser AI agent planner.
All PII on the page has already been redacted on-device into safe tokens (e.g. [EMAIL_1], [PHONE_1], ████).
Your job: output the single best NEXT action to accomplish the user's goal on ANY website.

USER GOAL: "{request.goal}"
PAGE TITLE: "{request.title}"
PAGE URL: {request.url}

AVAILABLE INTERACTIVE ELEMENTS:
{chr(10).join(elements_desc)}

SANITIZED PAGE TEXT (preview):
{request.sanitizedText[:1600]}

DECISION RULES & HYBRID HEURISTICS:
1. Search & Input:
   - To type or search: action=type, targetIndex=<index>, selector=<selector>, value="{dynamic_query}"
2. E-Commerce (Amazon, Flipkart, Myntra, Walmart, Target, etc.):
   - When searching for a product (e.g. "iPhone 17 Pro", "MacBook M4"):
     * Select the actual genuine product title/card link.
     * NEVER select accessories (phone cases, covers, tempered glass, cables) when user asks for a device.
     * If the exact model number is future/unreleased (e.g. iPhone 17), pick the top genuine flagship phone on screen.
     * NEVER select sponsored ads if an organic product is available.
   - On a product page: select "Add to Cart" or "Buy Now" button.
3. Audio & Video Streaming (YouTube, Spotify, Gaana, JioSaavn, SoundCloud, Apple Music):
   - Select the verified track title or play button for the requested song.
   - NEVER select the bottom footer player or previously playing song.
4. Auto-Fill: To fill credentials/forms/address: action=autofill
5. General Click: action=click, targetIndex=<index>, selector=<selector>
6. Scrolling: If the target item is clearly not visible in the preview, action=scroll, direction=down, amount=500
7. Done: If the goal is fulfilled: action=finish

Respond ONLY with raw JSON (no markdown, no backticks):
{{
  "thought": "concise reasoning for chosen action",
  "action": "click" | "type" | "scroll" | "navigate" | "autofill" | "select" | "press_key" | "hover" | "wait" | "finish",
  "targetIndex": number or null,
  "selector": string or null,
  "value": string or null,
  "direction": "up" | "down" or null,
  "amount": number or null,
  "confidence": number 0.0-1.0
}}"""

            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{GEMINI_MODEL}:generateContent?key={gemini_key}"
            )

            parts = []
            has_visual = False

            if request.redactedScreenshot:
                img_data = request.redactedScreenshot.strip()
                mime_type = "image/jpeg"
                if "base64," in img_data:
                    header, img_data = img_data.split("base64,", 1)
                    if "image/png" in header:
                        mime_type = "image/png"
                    elif "image/webp" in header:
                        mime_type = "image/webp"

                img_data = img_data.strip()
                if len(img_data) > 100:
                    parts.append({
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": img_data
                        }
                    })
                    has_visual = True

            visual_notice = ""
            if has_visual:
                visual_notice = """
VISUAL PERCEPTION & PRIVACY CONTEXT:
A high-resolution, on-device redacted screenshot of the live viewport is attached above.
Solid black rectangular boxes with security badges (e.g. [CVV], [CARD_EXPIRY], [ADDRESS], [OTP], [AADHAAR], [PAN], [PASSWORD]) represent sensitive personal data that was safely censored on-device before transmission.
Use BOTH the visual layout (visual icons, shopping carts, badges, banners, buttons, spatial layout) and the interactive element tree below to determine the single best NEXT action.
"""

            full_prompt = f"{prompt}\n{visual_notice}" if visual_notice else prompt
            parts.append({"text": full_prompt})

            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "temperature": 0.1,
                    "maxOutputTokens": 512,
                },
            }

            try:
                raw_res = _call_gemini_with_retry(url, payload)
                content_text = raw_res["candidates"][0]["content"]["parts"][0]["text"].strip()

                # Strip possible markdown code fence
                if content_text.startswith("```json"):
                    content_text = content_text[7:]
                if content_text.startswith("```"):
                    content_text = content_text[3:]
                if content_text.endswith("```"):
                    content_text = content_text[:-3]

                parsed = json.loads(content_text.strip())
                mode_label = "multimodal visual" if has_visual else "text-only"
                print(f"[PIXEL NOVA] Gemini ({mode_label}) action: {parsed.get('action')} | confidence: {parsed.get('confidence')}")
                return PlanResponse(**parsed)

            except Exception as gemini_err:
                print(f"[PIXEL NOVA] Gemini multimodal attempt exception: {repr(gemini_err)}")
                # If visual payload failed, immediately fallback to text-only Gemini reasoning
                if has_visual:
                    print("[PIXEL NOVA] Falling back to text-only Gemini reasoning...")
                    text_payload = {
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "temperature": 0.1,
                            "maxOutputTokens": 512,
                        },
                    }
                    raw_res = _call_gemini_with_retry(url, text_payload, max_retries=1)
                    content_text = raw_res["candidates"][0]["content"]["parts"][0]["text"].strip()

                    if content_text.startswith("```json"):
                        content_text = content_text[7:]
                    if content_text.startswith("```"):
                        content_text = content_text[3:]
                    if content_text.endswith("```"):
                        content_text = content_text[:-3]

                    parsed = json.loads(content_text.strip())
                    print(f"[PIXEL NOVA] Gemini (text fallback) action: {parsed.get('action')} | confidence: {parsed.get('confidence')}")
                    return PlanResponse(**parsed)
                raise gemini_err

        except Exception as e:
            print(f"[PIXEL NOVA] Gemini reasoning exception or rate-limit: {repr(e)}")
            print("[PIXEL NOVA] 🔄 Auto-Failover: Cascading to Secondary Provider (vLLM / Qwen3-VL)...")

    # Secondary Provider: Self-Hosted Open-Weights VLM (vLLM / Ollama)
    # Automatically triggers if VLM_PROVIDER is set to vLLM OR as an automatic failover when Gemini fails!
    if VLM_PROVIDER in ["vllm", "ollama", "openai"] or (not gemini_key or "gemini_err" in locals() or "e" in locals()):
        try:
            print(f"[PIXEL NOVA] Dispatching to Open-Weights VLM ({OPENAI_COMPATIBLE_MODEL}) at {OPENAI_COMPATIBLE_BASE_URL}...")

            
            # Format OpenAI-compatible multimodal content
            messages = [{"role": "system", "content": "You are PIXEL NOVA's Remote Brain. Respond ONLY with valid raw JSON adhering to schema."}]
            user_content = [{"type": "text", "text": full_prompt if 'full_prompt' in locals() else request.goal}]
            
            if request.redactedScreenshot:
                img_data = request.redactedScreenshot.strip()
                if not img_data.startswith("data:"):
                    img_data = f"data:image/jpeg;base64,{img_data}"
                user_content.append({
                    "type": "image_url",
                    "image_url": {"url": img_data}
                })

            messages.append({"role": "user", "content": user_content})

            vlm_payload = {
                "model": OPENAI_COMPATIBLE_MODEL,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": 512,
                "response_format": {"type": "json_object"}
            }

            vlm_res = _call_openai_compatible_vlm(vlm_payload)
            raw_content = vlm_res["choices"][0]["message"]["content"].strip()
            
            if raw_content.startswith("```json"):
                raw_content = raw_content[7:]
            if raw_content.startswith("```"):
                raw_content = raw_content[3:]
            if raw_content.endswith("```"):
                raw_content = raw_content[:-3]
                
            parsed = json.loads(raw_content.strip())
            print(f"[PIXEL NOVA] Open-Weights VLM ({OPENAI_COMPATIBLE_MODEL}) action: {parsed.get('action')} | confidence: {parsed.get('confidence')}")
            return PlanResponse(**parsed)

        except Exception as vlm_err:
            print(f"[PIXEL NOVA] Open-Weights VLM dispatch exception: {repr(vlm_err)}")

    # Fallback: Offline Semantic Keyword Planner
    return fallback_semantic_planner(request)


def fallback_semantic_planner(request: PlanRequest) -> PlanResponse:
    """
    Intelligent offline semantic planner for zero-network resilience during demos.
    Uses keyword matching against interactive elements to determine best action.
    """
    goal_lower = request.goal.lower()
    dynamic_query = extract_query_from_goal(request.goal)

    # 1. Navigation handling
    nav_match = re.search(r"\b(?:open|go\s+to|navigate(?:\s+to)?|visit|browse(?:\s+to)?)\s+['\"]?([^'\"]+?)['\"]?$", request.goal, re.IGNORECASE)
    if nav_match:
        target = nav_match.group(1).strip()
        if not re.search(r"\b(?:cart|carts|order|orders|here|there)\b", target, re.IGNORECASE):
            return PlanResponse(
                thought=f"Navigating to destination: {target}",
                action="navigate",
                value=target,
                confidence=0.95
            )

    # 2. Autofill handling
    if re.search(r"\b(?:auto\s*fill|fill\s*(?:my\s*)?(?:details|form|data|credentials|address|kyc|info)|populate\s*form)\b", goal_lower):
        return PlanResponse(
            thought="Populating form fields with on-device Privacy Vault credentials.",
            action="autofill",
            confidence=0.95
        )

    tokens = [t for t in re.split(r"\W+", goal_lower) if len(t) > 2]

    best_match_idx: Optional[int] = None
    best_match_selector: Optional[str] = None
    best_match_score = -1
    best_element_text = ""

    for el in request.safeElements:
        combined = f"{el.text} {el.ariaLabel or ''} {el.placeholder or ''} {el.id or ''} {el.name or ''}".lower()
        score = 0

        for token in tokens:
            if token in combined:
                score += 3
            if el.text and token == el.text.lower():
                score += 6

        # Intent-specific boosts
        if "search" in goal_lower and (el.tag == "input" or "search" in combined):
            score += 8
        if "order" in goal_lower and ("order" in combined or "track" in combined):
            score += 10
        if "cart" in goal_lower and "cart" in combined:
            score += 10
        if "profile" in goal_lower and ("profile" in combined or "account" in combined):
            score += 10
        if "login" in goal_lower and ("login" in combined or "sign in" in combined):
            score += 10

        if score > best_match_score and score > 0:
            best_match_score = score
            best_match_idx = el.index
            best_match_selector = el.selector
            best_element_text = el.text or el.placeholder or el.id or el.tag

    if best_match_idx is not None:
        target_el = next((e for e in request.safeElements if e.index == best_match_idx), None)
        if target_el and target_el.tag in ("input", "textarea"):
            return PlanResponse(
                thought=f"Identified input field '{best_element_text}'. Typing '{dynamic_query}'.",
                action="type",
                targetIndex=best_match_idx,
                selector=best_match_selector,
                value=dynamic_query,
                confidence=0.88,
            )
        return PlanResponse(
            thought=f"Located '{best_element_text}' matching goal. Clicking.",
            action="click",
            targetIndex=best_match_idx,
            selector=best_match_selector,
            confidence=0.90,
        )

    if "scroll" in goal_lower:
        return PlanResponse(
            thought="Scrolling down to reveal more page content.",
            action="scroll",
            direction="down",
            amount=450,
            confidence=0.85,
        )

    if any(kw in request.sanitizedText.lower() for kw in ["order", "confirmation", "success", "thank you"]):
        return PlanResponse(
            thought="Goal appears fulfilled — target information is visible on screen.",
            action="finish",
            confidence=0.95,
        )

    return PlanResponse(
        thought="No clear next action found. Marking as complete.",
        action="finish",
        confidence=0.75,
    )
