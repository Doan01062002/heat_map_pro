import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import InvestigateRequest, DiagnosisResult
from react_engine import run_investigation

app = FastAPI(
    title="Real-Time Context-Aware AI Agent Service",
    version="1.0.0",
    description="Tool-augmented AI Agent for grounding driver deviations with live weather, news, and telemetry."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "ai-agent",
        "has_groq_key": bool(os.getenv("GROQ_API_KEY")),
        "has_gemini_key": bool(os.getenv("GEMINI_API_KEY"))
    }

@app.post("/investigate", response_model=DiagnosisResult)
async def investigate(req: InvestigateRequest):
    try:
        result = await run_investigation(req)
        return result
    except Exception as e:
        print(f"[API Error] Investigation failed for {req.h3_index}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8090, reload=True)
