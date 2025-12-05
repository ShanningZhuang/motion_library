from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import timedelta
from typing import Optional, List
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config import settings
from auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    Token
)
from models import (
    LoginRequest,
    TrajectoryListResponse,
    TrajectoryUploadResponse,
    ModelListResponse,
    ErrorResponse
)
from storage import storage


app = FastAPI(
    title="Motion Library API",
    description="API for managing and visualizing robot motion trajectories",
    version="1.0.0"
)

# Rate limiter setup
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", settings.FRONTEND_URL],
    # allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Motion Library API",
        "version": "1.0.0",
        "docs": "/docs"
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


# Authentication endpoints
@app.post("/api/auth/login", response_model=Token)
@limiter.limit("5/5minutes")  # 5 attempts per 5 minutes per IP
async def login(request: Request, login_request: LoginRequest):
    """Authenticate and get access token with rate limiting."""
    if not authenticate_user(login_request.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": "admin"}, expires_delta=access_token_expires
    )

    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/api/auth/verify")
async def verify(current_user: str = Depends(get_current_user)):
    """Verify token is valid."""
    return {"valid": True, "user": current_user}


# Trajectory endpoints
@app.get("/api/trajectories", response_model=TrajectoryListResponse)
async def list_trajectories(
    category: Optional[str] = None,
    current_user: str = Depends(get_current_user)
):
    """List all trajectories."""
    trajectories = storage.list_trajectories(category=category)
    return TrajectoryListResponse(
        trajectories=trajectories,
        total=len(trajectories)
    )


@app.get("/api/trajectories/{trajectory_id}")
async def get_trajectory(
    trajectory_id: str,
    current_user: str = Depends(get_current_user)
):
    """Download a trajectory file."""
    file_path = storage.get_trajectory(trajectory_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Trajectory not found")

    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=file_path.name
    )


@app.post("/api/trajectories", response_model=TrajectoryUploadResponse)
async def upload_trajectory(
    file: UploadFile = File(...),
    category: Optional[str] = Form(None),
    current_user: str = Depends(get_current_user)
):
    """Upload a new trajectory file."""
    # Validate file extension
    if not file.filename.endswith(('.npy', '.npz')):
        raise HTTPException(
            status_code=400,
            detail="Only .npy and .npz files are supported"
        )

    # Read file content
    content = await file.read()

    try:
        # Save trajectory
        trajectory = storage.save_trajectory(
            filename=file.filename,
            content=content,
            category=category
        )

        return TrajectoryUploadResponse(
            success=True,
            message="Trajectory uploaded successfully",
            trajectory=trajectory
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload trajectory: {str(e)}"
        )


@app.delete("/api/trajectories/{trajectory_id}")
async def delete_trajectory(
    trajectory_id: str,
    current_user: str = Depends(get_current_user)
):
    """Delete a trajectory file."""
    if storage.delete_trajectory(trajectory_id):
        return {"success": True, "message": "Trajectory deleted successfully"}
    else:
        raise HTTPException(status_code=404, detail="Trajectory not found")


# Model endpoints
@app.get("/api/models", response_model=ModelListResponse)
async def list_models(current_user: str = Depends(get_current_user)):
    """List all models."""
    models = storage.list_models()
    return ModelListResponse(
        models=models,
        total=len(models)
    )


@app.get("/api/models/{model_id}")
async def get_model(
    model_id: str,
    current_user: str = Depends(get_current_user)
):
    """Download a model file."""
    file_path = storage.get_model(model_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Model not found")

    return FileResponse(
        path=file_path,
        media_type="application/xml",
        filename=file_path.name
    )


@app.post("/api/models")
async def upload_model(
    file: UploadFile = File(...),
    model_name: Optional[str] = Form(None),
    current_user: str = Depends(get_current_user)
):
    """Upload a new model file."""
    # Validate file extension
    if not file.filename.endswith('.xml'):
        raise HTTPException(
            status_code=400,
            detail="Only .xml files are supported"
        )

    # Read file content
    content = await file.read()

    try:
        # Save model
        model = storage.save_model(
            filename=file.filename,
            content=content,
            model_name=model_name
        )

        return {
            "success": True,
            "message": "Model uploaded successfully",
            "model": model
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to upload model: {str(e)}"
        )


@app.delete("/api/models/{model_id}")
async def delete_model(
    model_id: str,
    current_user: str = Depends(get_current_user)
):
    """Delete a model file."""
    if storage.delete_model(model_id):
        return {"success": True, "message": "Model deleted successfully"}
    else:
        raise HTTPException(status_code=404, detail="Model not found")


@app.get("/api/models/{model_id}/files")
async def list_model_files(
    model_id: str,
    current_user: str = Depends(get_current_user)
):
    """List all files in a model's directory."""
    files = storage.get_model_directory_files(model_id)
    if not files:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"files": files}


@app.get("/api/models/{model_id}/files/{file_path:path}")
async def get_model_file(
    model_id: str,
    file_path: str,
    current_user: str = Depends(get_current_user)
):
    """Get a specific file from a model's directory."""
    file_abs_path = storage.get_file_in_model_directory(model_id, file_path)
    if not file_abs_path:
        raise HTTPException(status_code=404, detail="File not found in model directory")

    # Determine media type based on file extension
    media_type = "application/octet-stream"
    suffix = file_abs_path.suffix.lower()
    
    if suffix == '.xml':
        media_type = "application/xml"
    elif suffix == '.stl':
        media_type = "model/stl"
    elif suffix in ['.obj', '.dae', '.mesh']:
        media_type = "model/mesh"
    elif suffix == '.png':
        media_type = "image/png"
    elif suffix in ['.jpg', '.jpeg']:
        media_type = "image/jpeg"
    elif suffix == '.gif':
        media_type = "image/gif"
    elif suffix == '.webp':
        media_type = "image/webp"
    elif suffix == '.svg':
        media_type = "image/svg+xml"

    return FileResponse(
        path=file_abs_path,
        media_type=media_type,
        filename=file_abs_path.name
    )


# Thumbnail endpoints
@app.get("/api/models/{model_id}/thumbnail")
async def get_model_thumbnail(
    model_id: str,
    current_user: str = Depends(get_current_user)
):
    """Get thumbnail image for a model."""
    print(f"[THUMBNAIL] Model thumbnail request: model_id={model_id}")
    thumbnail_path = storage.get_model_thumbnail(model_id)
    if not thumbnail_path:
        print(f"[THUMBNAIL] Model thumbnail not found for id={model_id}")
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    print(f"[THUMBNAIL] Model thumbnail found: {thumbnail_path}")

    # Determine media type based on extension
    media_type = "image/webp"
    if thumbnail_path.suffix == ".png":
        media_type = "image/png"
    elif thumbnail_path.suffix == ".jpg":
        media_type = "image/jpeg"
    elif thumbnail_path.suffix == ".gif":
        media_type = "image/gif"

    print(f"[THUMBNAIL] Serving with media_type={media_type}")

    return FileResponse(
        path=thumbnail_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"}
    )


@app.get("/api/trajectories/{trajectory_id}/thumbnail")
async def get_trajectory_thumbnail(
    trajectory_id: str,
    current_user: str = Depends(get_current_user)
):
    """Get thumbnail animation for a trajectory."""
    print(f"[THUMBNAIL] Trajectory thumbnail request: trajectory_id={trajectory_id}")
    thumbnail_path = storage.get_trajectory_thumbnail(trajectory_id)
    if not thumbnail_path:
        print(f"[THUMBNAIL] Trajectory thumbnail not found for id={trajectory_id}")
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    print(f"[THUMBNAIL] Trajectory thumbnail found: {thumbnail_path}")

    # Determine media type based on extension
    media_type = "image/webp"
    if thumbnail_path.suffix == ".gif":
        media_type = "image/gif"
    elif thumbnail_path.suffix == ".png":
        media_type = "image/png"
    elif thumbnail_path.suffix == ".jpg":
        media_type = "image/jpeg"

    print(f"[THUMBNAIL] Serving with media_type={media_type}")

    return FileResponse(
        path=thumbnail_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600"}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True
    )
