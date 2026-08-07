from typing import Any, Optional
from pydantic import BaseModel, Field

class InvestigateRequest(BaseModel):
    h3_index: str = Field(..., description="H3 hexagon cell index")
    lat: float = Field(..., description="Latitude of center of cell")
    lng: float = Field(..., description="Longitude of center of cell")
    time_window_minutes: int = Field(default=60, description="Time window for telemetry analysis in minutes")
    timestamp_ms: Optional[int] = Field(default=None, description="Epoch milliseconds timestamp of the drivers/trips being analyzed")

class WeatherEvidence(BaseModel):
    temperature: Optional[float] = None
    rain_mm: Optional[float] = None
    description: str = "Unknown"
    wind_speed: Optional[float] = None
    weather_time: str = "Real-time"  # E.g. "2013-07-01 15:00 UTC" or "Real-time"

class TelemetryEvidence(BaseModel):
    total_events: int = 0
    unique_drivers: int = 0
    unique_trips: int = 0
    high_dev_trips: int = 0
    fleet_deviation_ratio: float = 0.0
    avg_speed_kmh: float = 0.0
    avg_deviation_m: float = 0.0

class NewsItem(BaseModel):
    title: str
    source: str = ""
    url: str = ""
    snippet: str = ""

class Evidence(BaseModel):
    weather: Optional[WeatherEvidence] = None
    news: list[NewsItem] = Field(default_factory=list)
    fleet_telemetry: TelemetryEvidence
    location_name: str
    target_time_str: str = ""  # Human readable target timestamp string

class DiagnosisResult(BaseModel):
    h3_index: str
    risk_level: str  # "SAFE_FORCE_MAJEURE" | "SUSPICIOUS" | "FRAUD_ALERT" | "ANALYSIS_UNAVAILABLE"
    confidence: float  # 0.0 to 1.0
    summary: str
    evidence: Evidence
    recommendation: str
