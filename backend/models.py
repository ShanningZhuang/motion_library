from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class LoginRequest(BaseModel):
    password: str


class TrajectoryMetadata(BaseModel):
    id: str
    filename: str
    category: Optional[str] = None
    file_size: int
    upload_date: datetime
    frame_count: Optional[int] = None
    frame_rate: Optional[float] = None
    num_joints: Optional[int] = None
    thumbnail_path: Optional[str] = None


class TrajectoryUploadResponse(BaseModel):
    success: bool
    message: str
    trajectory: Optional[TrajectoryMetadata] = None


class TrajectoryListResponse(BaseModel):
    trajectories: List[TrajectoryMetadata]
    total: int


class ModelMetadata(BaseModel):
    id: str
    filename: str
    model_name: Optional[str] = None  # Model directory name (e.g., "MS-Human-700")
    relative_path: str  # Path from models dir (e.g., "MS-Human-700/MS-Human-700-MJX.xml")
    file_size: int
    upload_date: datetime
    thumbnail_path: Optional[str] = None


class ModelListResponse(BaseModel):
    models: List[ModelMetadata]
    total: int


class ErrorResponse(BaseModel):
    detail: str
