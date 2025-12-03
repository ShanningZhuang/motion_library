import os
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Tuple
import hashlib
from models import TrajectoryMetadata, ModelMetadata
from config import settings


class StorageManager:
    """Manages file system storage for trajectories and models."""

    def __init__(self):
        self.models_dir = settings.get_models_path()
        self.trajectories_dir = settings.get_trajectories_path()
        self.base_path = Path(settings.DATA_DIR).resolve()
        self.thumbnails_dir = self.base_path / "thumbnails"

        # Ensure directories exist
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.trajectories_dir.mkdir(parents=True, exist_ok=True)
        (self.thumbnails_dir / "models").mkdir(parents=True, exist_ok=True)
        (self.thumbnails_dir / "trajectories").mkdir(parents=True, exist_ok=True)

    def _get_file_id(self, filename: str) -> str:
        """Generate a unique ID for a file."""
        return hashlib.md5(filename.encode()).hexdigest()[:16]

    def _parse_trajectory_file(self, file_path: Path) -> Tuple[Optional[int], Optional[float], Optional[int]]:
        """Parse NPY/NPZ file to extract metadata."""
        try:
            if file_path.suffix == '.npz':
                data = np.load(file_path)
                qpos = data.get('qpos_traj')
                frame_rate = data.get('frame_rate', data.get('framerate'))

                if qpos is not None:
                    frame_count = qpos.shape[0] if len(qpos.shape) > 1 else len(qpos)
                    num_joints = qpos.shape[1] if len(qpos.shape) > 1 else None
                else:
                    frame_count = None
                    num_joints = None

                if frame_rate is not None:
                    frame_rate = float(frame_rate)

                return frame_count, frame_rate, num_joints

            elif file_path.suffix == '.npy':
                data = np.load(file_path)
                if len(data.shape) > 1:
                    frame_count = data.shape[0]
                    num_joints = data.shape[1]
                else:
                    frame_count = len(data)
                    num_joints = None

                return frame_count, None, num_joints

        except Exception as e:
            print(f"Error parsing trajectory file {file_path}: {e}")

        return None, None, None

    def _find_thumbnail(self, item_id: str, item_type: str) -> Optional[str]:
        """Find thumbnail file for a model or trajectory by ID.

        Args:
            item_id: The ID of the model or trajectory
            item_type: Either "models" or "trajectories"

        Returns:
            Relative path from base_path if thumbnail exists, None otherwise
        """
        thumbnail_dir = self.thumbnails_dir / item_type

        # Look for thumbnail files recursively (thumbnails mirror directory structure)
        # e.g., thumbnails/models/MS-Human-700/{id}.webp
        for ext in ['.webp', '.png', '.jpg', '.gif']:
            # Search recursively for matching thumbnail
            for thumbnail_file in thumbnail_dir.rglob(f"{item_id}{ext}"):
                return str(thumbnail_file.relative_to(self.base_path))

        return None

    def list_trajectories(self, category: Optional[str] = None) -> List[TrajectoryMetadata]:
        """List all trajectory files."""
        trajectories = []

        # Walk through trajectories directory
        for root, dirs, files in os.walk(self.trajectories_dir):
            rel_path = Path(root).relative_to(self.trajectories_dir)
            current_category = str(rel_path) if str(rel_path) != '.' else None

            # Filter by category if specified
            if category and current_category != category:
                continue

            for filename in files:
                if filename.endswith(('.npy', '.npz')):
                    file_path = Path(root) / filename
                    stat = file_path.stat()

                    # Parse trajectory file
                    frame_count, frame_rate, num_joints = self._parse_trajectory_file(file_path)

                    # Get trajectory ID and check for thumbnail
                    trajectory_id = self._get_file_id(str(file_path.relative_to(self.trajectories_dir)))
                    thumbnail_path = self._find_thumbnail(trajectory_id, "trajectories")

                    trajectories.append(TrajectoryMetadata(
                        id=trajectory_id,
                        filename=filename,
                        category=current_category,
                        file_size=stat.st_size,
                        upload_date=datetime.fromtimestamp(stat.st_mtime),
                        frame_count=frame_count,
                        frame_rate=frame_rate,
                        num_joints=num_joints,
                        thumbnail_path=thumbnail_path
                    ))

        return sorted(trajectories, key=lambda x: x.upload_date, reverse=True)

    def get_trajectory(self, trajectory_id: str) -> Optional[Path]:
        """Get trajectory file path by ID."""
        for root, dirs, files in os.walk(self.trajectories_dir):
            for filename in files:
                if filename.endswith(('.npy', '.npz')):
                    file_path = Path(root) / filename
                    rel_path = file_path.relative_to(self.trajectories_dir)
                    if self._get_file_id(str(rel_path)) == trajectory_id:
                        return file_path
        return None

    def save_trajectory(self, filename: str, content: bytes, category: Optional[str] = None) -> TrajectoryMetadata:
        """Save a trajectory file."""
        # Determine save location
        if category:
            save_dir = self.trajectories_dir / category
            save_dir.mkdir(parents=True, exist_ok=True)
        else:
            save_dir = self.trajectories_dir

        file_path = save_dir / filename

        # Write file
        file_path.write_bytes(content)

        # Get metadata
        stat = file_path.stat()
        frame_count, frame_rate, num_joints = self._parse_trajectory_file(file_path)

        # Get trajectory ID and check for thumbnail
        trajectory_id = self._get_file_id(str(file_path.relative_to(self.trajectories_dir)))
        thumbnail_path = self._find_thumbnail(trajectory_id, "trajectories")

        return TrajectoryMetadata(
            id=trajectory_id,
            filename=filename,
            category=category,
            file_size=stat.st_size,
            upload_date=datetime.fromtimestamp(stat.st_mtime),
            frame_count=frame_count,
            frame_rate=frame_rate,
            num_joints=num_joints,
            thumbnail_path=thumbnail_path
        )

    def delete_trajectory(self, trajectory_id: str) -> bool:
        """Delete a trajectory file."""
        file_path = self.get_trajectory(trajectory_id)
        if file_path and file_path.exists():
            file_path.unlink()
            return True
        return False

    def list_models(self) -> List[ModelMetadata]:
        """List main model files (excluding component files in subdirectories)."""
        models = []

        # Scan for model directories and their main XML files
        # Only include XML files that are direct children of model directories
        for item in self.models_dir.iterdir():
            if item.is_dir():
                # This is a model directory (e.g., MS-Human-700)
                model_dir = item

                # Find XML files directly in this model directory (not in subdirs)
                for xml_file in model_dir.glob('*.xml'):
                    if xml_file.is_file():
                        stat = xml_file.stat()
                        rel_path = xml_file.relative_to(self.models_dir)

                        # Get model ID and check for thumbnail
                        model_id = self._get_file_id(str(rel_path))
                        thumbnail_path = self._find_thumbnail(model_id, "models")

                        models.append(ModelMetadata(
                            id=model_id,
                            filename=xml_file.name,
                            model_name=model_dir.name,  # e.g., "MS-Human-700"
                            relative_path=str(rel_path),
                            file_size=stat.st_size,
                            upload_date=datetime.fromtimestamp(stat.st_mtime),
                            thumbnail_path=thumbnail_path
                        ))
            elif item.suffix == '.xml':
                # XML file directly in models/ root (for backward compatibility)
                stat = item.stat()

                # Get model ID and check for thumbnail
                model_id = self._get_file_id(item.name)
                thumbnail_path = self._find_thumbnail(model_id, "models")

                models.append(ModelMetadata(
                    id=model_id,
                    filename=item.name,
                    model_name=None,
                    relative_path=item.name,
                    file_size=stat.st_size,
                    upload_date=datetime.fromtimestamp(stat.st_mtime),
                    thumbnail_path=thumbnail_path
                ))

        return sorted(models, key=lambda x: x.upload_date, reverse=True)

    def get_model(self, model_id: str) -> Optional[Path]:
        """Get model file path by ID."""
        # Check model directories
        for item in self.models_dir.iterdir():
            if item.is_dir():
                for xml_file in item.glob('*.xml'):
                    rel_path = xml_file.relative_to(self.models_dir)
                    if self._get_file_id(str(rel_path)) == model_id:
                        return xml_file
            elif item.suffix == '.xml':
                if self._get_file_id(item.name) == model_id:
                    return item
        return None

    def save_model(self, filename: str, content: bytes, model_name: Optional[str] = None) -> ModelMetadata:
        """Save a model file."""
        if model_name:
            # Save in a model directory
            model_dir = self.models_dir / model_name
            model_dir.mkdir(parents=True, exist_ok=True)
            file_path = model_dir / filename
        else:
            # Save directly in models root
            file_path = self.models_dir / filename

        file_path.write_bytes(content)
        stat = file_path.stat()
        rel_path = file_path.relative_to(self.models_dir)

        # Get model ID and check for thumbnail
        model_id = self._get_file_id(str(rel_path))
        thumbnail_path = self._find_thumbnail(model_id, "models")

        return ModelMetadata(
            id=model_id,
            filename=filename,
            model_name=model_name,
            relative_path=str(rel_path),
            file_size=stat.st_size,
            upload_date=datetime.fromtimestamp(stat.st_mtime),
            thumbnail_path=thumbnail_path
        )

    def delete_model(self, model_id: str) -> bool:
        """Delete a model file."""
        file_path = self.get_model(model_id)
        if file_path and file_path.exists():
            file_path.unlink()
            return True
        return False

    def get_model_directory_files(self, model_id: str) -> List[str]:
        """Get all files in a model's directory tree (relative paths)."""
        main_model_path = self.get_model(model_id)
        if not main_model_path:
            return []

        # Determine model directory
        if main_model_path.parent == self.models_dir:
            # Single file in root, only return the file itself
            return [main_model_path.name]
        else:
            # Model in a subdirectory, return all files in that directory tree
            model_dir = main_model_path.parent
            files = []

            for file_path in model_dir.rglob('*'):
                if file_path.is_file():
                    rel_path = file_path.relative_to(self.models_dir)
                    files.append(str(rel_path))

            return files

    def get_file_in_model_directory(self, model_id: str, file_relative_path: str) -> Optional[Path]:
        """Get a specific file from a model directory by relative path."""
        main_model_path = self.get_model(model_id)
        if not main_model_path:
            return None

        # Construct absolute path
        requested_file = self.models_dir / file_relative_path

        # Security check: ensure file is within models directory
        try:
            requested_file.resolve().relative_to(self.models_dir.resolve())
        except ValueError:
            # Path is outside models directory
            return None

        # Check if file exists
        if not requested_file.exists() or not requested_file.is_file():
            return None

        # Verify it's in the same model directory
        if main_model_path.parent == self.models_dir:
            # Single file model - only allow the main file
            if requested_file == main_model_path:
                return requested_file
        else:
            # Multi-file model - allow any file in the model directory
            model_dir = main_model_path.parent
            try:
                requested_file.resolve().relative_to(model_dir.resolve())
                return requested_file
            except ValueError:
                return None

        return None

    def get_model_thumbnail(self, model_id: str) -> Optional[Path]:
        """Get thumbnail path for a model by ID.

        Args:
            model_id: The model ID

        Returns:
            Path to thumbnail file if it exists, None otherwise
        """
        print(f"[STORAGE] Looking for model thumbnail: model_id={model_id}")
        thumbnail_dir = self.thumbnails_dir / "models"
        print(f"[STORAGE] Search directory: {thumbnail_dir}")
        print(f"[STORAGE] Directory exists: {thumbnail_dir.exists()}")

        # Search recursively for thumbnail (thumbnails mirror directory structure)
        for ext in ['.webp', '.png', '.jpg', '.gif']:
            matches = list(thumbnail_dir.rglob(f"{model_id}{ext}"))
            if matches:
                print(f"[STORAGE] Found {len(matches)} match(es) for {model_id}{ext}: {matches}")
                return matches[0]
            else:
                print(f"[STORAGE] No matches for pattern: {model_id}{ext}")

        print(f"[STORAGE] Model thumbnail not found after checking all extensions")
        return None

    def get_trajectory_thumbnail(self, trajectory_id: str) -> Optional[Path]:
        """Get thumbnail path for a trajectory by ID.

        Args:
            trajectory_id: The trajectory ID

        Returns:
            Path to thumbnail file if it exists, None otherwise
        """
        print(f"[STORAGE] Looking for trajectory thumbnail: trajectory_id={trajectory_id}")
        thumbnail_dir = self.thumbnails_dir / "trajectories"
        print(f"[STORAGE] Search directory: {thumbnail_dir}")
        print(f"[STORAGE] Directory exists: {thumbnail_dir.exists()}")

        # Search recursively for thumbnail (thumbnails mirror directory structure)
        for ext in ['.webp', '.png', '.jpg', '.gif']:
            matches = list(thumbnail_dir.rglob(f"{trajectory_id}{ext}"))
            if matches:
                print(f"[STORAGE] Found {len(matches)} match(es) for {trajectory_id}{ext}: {matches}")
                return matches[0]
            else:
                print(f"[STORAGE] No matches for pattern: {trajectory_id}{ext}")

        print(f"[STORAGE] Trajectory thumbnail not found after checking all extensions")
        return None


# Global storage manager instance
storage = StorageManager()
