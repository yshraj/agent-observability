from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal
from enum import Enum


class ActionType(str, Enum):
    read_file = "read_file"
    write_file = "write_file"
    run_command = "run_command"
    llm_call = "llm_call"


class EventStatus(str, Enum):
    success = "success"
    failure = "failure"


class EventMetadata(BaseModel):
    file: Optional[str] = None
    status: EventStatus = EventStatus.success


class EventIn(BaseModel):
    session_id: str
    timestamp: float
    step: int
    action: ActionType
    input: str = ""
    output: str = ""
    metadata: EventMetadata = Field(default_factory=EventMetadata)

    @field_validator("session_id")
    @classmethod
    def session_id_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("session_id cannot be empty")
        return v

    @field_validator("step")
    @classmethod
    def step_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("step must be >= 0")
        return v


class SessionStatus(str, Enum):
    healthy = "healthy"
    looping = "looping"
    drifting = "drifting"
    failing = "failing"


class SessionStats(BaseModel):
    total_steps: int
    success_count: int
    failure_count: int
    failure_rate: float
    action_distribution: dict[str, int]


class DetectedIssue(BaseModel):
    issue_type: Literal["loop", "drift", "failure"]
    description: str
    severity: Literal["low", "medium", "high"]
    affected_steps: list[int] = []


class SessionSummary(BaseModel):
    session_id: str
    status: SessionStatus
    stats: SessionStats
    event_count: int
    first_seen: float
    last_seen: float
    issues: list[DetectedIssue] = []


class EventRecord(BaseModel):
    session_id: str
    timestamp: float
    step: int
    action: str
    input: str
    output: str
    metadata_file: Optional[str]
    metadata_status: str
    received_at: float


class SessionDetail(BaseModel):
    session_id: str
    status: SessionStatus
    stats: SessionStats
    events: list[EventRecord]
    issues: list[DetectedIssue]
    insights: list[str]
