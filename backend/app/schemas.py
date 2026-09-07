from typing import List, Optional, Literal
from pydantic import BaseModel

class SafeElementSchema(BaseModel):
    index: int
    tag: str
    text: str
    ariaLabel: Optional[str] = None
    placeholder: Optional[str] = None
    type: Optional[str] = None
    id: Optional[str] = None
    name: Optional[str] = None
    selector: Optional[str] = None

class PlanRequest(BaseModel):
    goal: str
    title: str
    url: str
    sanitizedText: str
    safeElements: List[SafeElementSchema]
    redactedScreenshot: Optional[str] = None

class PlanResponse(BaseModel):
    thought: str
    action: Literal["click", "type", "scroll", "navigate", "wait", "finish"]
    targetIndex: Optional[int] = None
    selector: Optional[str] = None
    value: Optional[str] = None
    direction: Optional[Literal["up", "down"]] = None
    amount: Optional[int] = None
    confidence: float = 0.95

