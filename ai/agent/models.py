from typing import Any, Optional
from pydantic import BaseModel, Field

class InvestigateRequest(BaseModel):
    h3_index: str = Field(..., description="H3 hexagon cell index")
    lat: float = Field(..., description="Latitude of center of cell")
    lng: float = Field(..., description="Longitude of center of cell")
    time_window_minutes: int = Field(default=60, description="Time window for telemetry analysis in minutes")
    timestamp_ms: Optional[int] = Field(default=None, description="Epoch milliseconds timestamp of the drivers/trips being analyzed")
    driver_id: Optional[str] = Field(default=None, description="Optional target driver ID")

class WeatherEvidence(BaseModel):
    temperature: Optional[float] = None
    rain_mm: Optional[float] = None
    description: str = "Unknown"
    wind_speed: Optional[float] = None
    weather_time: str = "Real-time"

class TelemetryEvidence(BaseModel):
    total_events: int = 0
    unique_drivers: int = 0
    unique_trips: int = 0
    high_dev_trips: int = 0
    fleet_deviation_ratio: float = 0.0
    adjusted_deviation_ratio: float = 0.0  # Bayesian smoothed ratio
    wilson_lower_bound: float = 0.0         # 95% Wilson confidence lower bound
    wilson_upper_bound: float = 0.0         # 95% Wilson confidence upper bound
    margin_of_error: float = 0.0            # Statistical error margin
    dynamic_threshold_m: float = 150.0      # Road-class adapted deviation threshold (50m, 150m, 350m)
    avg_speed_kmh: float = 0.0
    avg_deviation_m: float = 0.0

class NewsItem(BaseModel):
    title: str
    source: str = ""
    url: str = ""
    snippet: str = ""

class OSRMAlternativeEvidence(BaseModel):
    has_alternatives: bool = False
    best_time_saving_sec: float = 0.0
    distance_diff_meters: float = 0.0
    route_classification: str = "STANDARD"  # "OPTIMIZED_SHORTCUT" | "INFLATED_DETOUR" | "STANDARD"
    summary: str = "Lộ trình chuẩn"

class DriverProfileEvidence(BaseModel):
    driver_id: str = "N/A"
    compliance_rate_30d: float = 1.0  # 0.0 to 1.0
    total_trips_30d: int = 0
    deviated_trips_30d: int = 0
    reputation_level: str = "EXCELLENT"  # "EXCELLENT" | "MODERATE" | "HIGH_RISK"

class TrafficSpeedEvidence(BaseModel):
    baseline_speed_kmh: float = 40.0
    current_speed_kmh: float = 40.0
    speed_drop_ratio: float = 0.0  # 0.0 to 1.0 (e.g. 0.8 = 80% speed drop)
    traffic_state: str = "CLEAR"  # "CLEAR" | "MODERATE_SLOW" | "SEVERE_GRIDLOCK"

class Evidence(BaseModel):
    weather: Optional[WeatherEvidence] = None
    news: list[NewsItem] = Field(default_factory=list)
    fleet_telemetry: TelemetryEvidence
    location_name: str
    target_time_str: str = ""
    osrm_alternatives: Optional[OSRMAlternativeEvidence] = None
    driver_profile: Optional[DriverProfileEvidence] = None
    traffic_speed: Optional[TrafficSpeedEvidence] = None

class DiagnosisResult(BaseModel):
    h3_index: str
    risk_level: str  # "SAFE_FORCE_MAJEURE" | "SUSPICIOUS" | "FRAUD_ALERT" | "ANALYSIS_UNAVAILABLE"
    confidence: float
    summary: str
    evidence: Evidence
    recommendation: str
