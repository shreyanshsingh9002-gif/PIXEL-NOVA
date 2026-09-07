from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Ensure .env is loaded
load_dotenv()

from app.schemas import PlanRequest, PlanResponse
from app.planner import plan_action

app = FastAPI(
    title="PIXEL NOVA Remote Brain",
    description="Privacy-first remote reasoning engine for browser agents",
    version="0.1.0"
)

# Enable CORS for Chrome Extension & Local testbed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    provider = os.getenv("VLM_PROVIDER", "gemini").lower()
    active_model = os.getenv("OPENAI_COMPATIBLE_MODEL", "Qwen/Qwen3-VL-7B-Instruct") if provider in ["vllm", "ollama"] else os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    return {
        "name": "PIXEL NOVA Remote Brain",
        "status": "online",
        "provider": provider,
        "active_model": active_model,
        "supported_open_models": [
            "Qwen/Qwen3-VL-7B-Instruct",
            "Qwen/Qwen2.5-VL-7B-Instruct",
            "Qwen/Qwen3.8-Flash",
            "meta-llama/Llama-3.2-11B-Vision-Instruct",
            "microsoft/Phi-3.5-vision-instruct"
        ],
        "has_gemini_key": bool(os.getenv("GEMINI_API_KEY")),
        "description": "See. Understand. Protect. Privacy-First Browser Agent Engine."
    }

@app.get("/health")
async def health():
    provider = os.getenv("VLM_PROVIDER", "gemini").lower()
    active_model = os.getenv("OPENAI_COMPATIBLE_MODEL", "Qwen/Qwen3-VL-7B-Instruct") if provider in ["vllm", "ollama"] else os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    return {
        "status": "healthy",
        "provider": provider,
        "active_model": active_model,
        "timestamp": 1772873400
    }

@app.post("/api/agent/plan", response_model=PlanResponse)
async def plan(request: PlanRequest):
    try:
        response = await plan_action(request)
        return response
    except Exception as e:
        print(f"Error in plan endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)

