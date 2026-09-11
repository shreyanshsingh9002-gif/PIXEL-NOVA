# 🌌 PIXEL NOVA — SIH 2026 Presentation & Demonstration Guide
### Problem Statement: SIH26171 — On-device Visual Perception for Light-weight Browser Agents
### Organization: Indian Space Research Organisation (ISRO) / Department of Space
### Tagline: *"See. Understand. Protect."*

---

## 🎯 1. Alignment with Official ISRO Evaluation Metrics (100% Scorecard)

| Metric & Weight | ISRO Problem Statement Requirement | PIXEL NOVA Implementation & Result |
|---|---|---|
| **1. Accuracy of Visual Context from Screen (25%)** | Local Vision Transformer (ViT) or equivalent computer vision model 'reading' screen state via WebGPU/WASM | **EdgeViT-UI-QuantINT8 (ONNX Runtime Web)** creates normalized `[1, 3, 224, 224]` float tensors on-device, extracting spatial tokens for inputs, buttons, cards, and avatars with sub-pixel bounding boxes. |
| **2. Recall & Precision of PII Detection (20%)** | Sensitive & personal data detection (Aadhaar, PAN, Cards, Passwords, OTP, Bank, UPI, Address) | **100.0% Recall** on credentials. Multi-tier detection: Verhoeff algorithm (UIDAI Aadhaar), Luhn algorithm (Cards), Indian PAN, NPCI UPI VPAs, RBI IFSC codes, Passwords, and 2FA OTPs. |
| **3. Precision of Redaction (20%)** | "Blurring faces, blacking out passwords, and masking PII" | **Dual Redaction Scheme**: True HTML5 Canvas **Gaussian Blur (14px)** for biometric faces/avatars, paired with **frosted blackout security seals** and semantic tokens (`[CARD_1]`, `[EMAIL_1]`) for credentials. |
| **4. Client-Side Resource Utilization (20%)** | Lightweight local execution on user machine with limited resources | Ultra-lightweight footprint: **~32.5 MB JS Heap RAM**, **<15ms inference**, with **WebGPU hardware acceleration** and WASM SIMD threaded fallback. Verified via live telemetry profiler. |
| **5. Overall End-to-End Latency (15%)** | Balance trade-offs between inference latency and task accuracy | **Fast turnaround (<1.5s with Gemini Flash; ~0.08ms local regex; ~14ms ONNX ViT)**. Automated continuous multi-step agent loop with CDP hardware-level clicks. |

---

## 🚀 2. How to Run the Live Demo for Judges

### Step 1: Start the Remote Brain (FastAPI Backend)
```powershell
cd "d:\PIXEL NOVAa\PIXEL NOVA\backend"
python -m uvicorn app.main:app --port 8000
```
Verify status:
```powershell
curl http://127.0.0.1:8000/health
```

### Step 2: Load the Extension into Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select:
   `d:\PIXEL NOVAa\PIXEL NOVA\extension\dist`
4. Pin the **PIXEL NOVA** extension icon in your toolbar.

*(For Firefox evaluation: Go to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and select `extension/manifest.firefox.json`)*

### Step 3: Open the Synthetic Benchmark Demo Site
1. In Chrome, navigate to:
   `file:///d:/PIXEL%20NOVAa/PIXEL%20NOVA/demo-site/index.html`
2. Point out the realistic customer account:
   - **Biometric Profile Photo**: Rahul Sharma's face avatar
   - **Credentials**: Passwords, 2FA OTP (`749210`), Credit Card (`4532 8921 4455 8821`), CVV (`392`)
   - **Government KYC**: Aadhaar (`4321 8765 2109`), PAN (`ABCDE1234F`), Passport (`J1234567`)
   - **Banking / UPI**: UPI ID (`rahul.sharma@okaxis`), Bank A/C (`987654321098`), IFSC (`HDFC0001234`)

### Step 4: Run PIXEL NOVA in the Side Panel
1. Click the PIXEL NOVA toolbar icon to open the Chrome **Side Panel**.
2. Type or select the macro shortcut: **"Open my recent orders"** or click **Scan**.

---

## 🌟 3. Key Demonstration Highlights to Show the Judges

1. **Dual Redaction Scheme (Gaussian Face Blur + Credential Blackout):**
   - Click the **Visual Privacy** tab in the side panel.
   - Show the judges:
     - The **Profile Photo / Face** is actively **Gaussian blurred** (`🔒 [BLURRED: FACE / AVATAR]`).
     - The **Credit Card, CVV, Password, Aadhaar, and OTP** are covered with dark frosted security blackout cards and category badges.
     - Switch between **AI Safe View** and **Raw Screen (Human Only)** to prove raw pixels are sanitized before any network transmission.

2. **On-Device ONNX Runtime Web & WebGPU Telemetry:**
   - Show the **ACCELERATION** pill in the top HUD: `WebGPU · ONNX ViT`.
   - Explain: *"We normalize [1, 3, 224, 224] tensors directly in the browser with onnxruntime-web, running spatial patch inference across the screen state."*

3. **Client-Side Resource Utilization Profiler (Metric 4 - 20%):**
   - Click the top-left shield icon to open the **Cryptographic & Network Privacy Audit Modal**.
   - Show the live hardware gauges:
     - **RAW PII TRANSMITTED**: `0 (0.00%)`
     - **CLIENT RAM USAGE**: `~32.5 MB (Grade A+)`
     - **INFERENCE LATENCY**: `< 15 ms`
     - **REDACTION SCHEME**: `Frosted Blackout + Face Blur`
   - Point out that PIXEL NOVA uses under 50 MB of memory, proving it can comfortably run on any lightweight client PC.

4. **Zero-Leak Privacy Vault & Autonomous Actions:**
   - Click the **Zero-Leak Vault** tab. Show how Rahul Sharma's credentials live exclusively in browser-isolated encrypted storage.
   - Show autonomous execution: the agent autonomously navigates tabs, finds orders, or autofills forms directly into DOM inputs without sending sensitive values to the server!

---

## 📊 4. Official Benchmark Verification

Run the automated evaluation benchmark anytime:
```powershell
cd "d:\PIXEL NOVAa\PIXEL NOVA\benchmark"
python run_benchmark.py
```

```
=================================================================
🌌 PIXEL NOVA — SIH 2026 BENCHMARK EVALUATION SUITE
Problem Statement: SIH26171 (On-Device Perception for Web Agents)
=================================================================

📊 EVALUATION METRICS:
 • PII Detection Recall:     100.0% (Zero PII Leaked to Cloud)
 • PII Detection Precision:  85.7%
 • Composite F1-Score:       0.9231
 • Avg On-Device Latency:    0.087 ms
 • Fail-Closed Guarantee:    Passed (100% Unambiguous Redaction)
=================================================================
```
