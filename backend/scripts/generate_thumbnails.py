#!/usr/bin/env python3
"""
Generate thumbnails for models and animated WebP for trajectories.

This script uses subcommands to separate model and trajectory rendering:
- render-model: Generate thumbnail for ONE specific model
- render-trajectory: Generate animation for trajectory(ies) with a specific model

Usage:
    # Render a model thumbnail
    python scripts/generate_thumbnails.py render-model --model "MS-Human-700/MS-Human-700-MJX.xml"

    # Render a model with custom camera
    python scripts/generate_thumbnails.py render-model --model "MS-Human-700/MS-Human-700-MJX.xml" --distance 5.0 --azimuth 90

    # Render a single trajectory
    python scripts/generate_thumbnails.py render-trajectory --trajectory "locomotion/walk.npy" --model "MS-Human-700/MS-Human-700-MJX.xml"

    # Render all trajectories in a folder
    python scripts/generate_thumbnails.py render-trajectory --trajectory "locomotion/" --model "MS-Human-700/MS-Human-700-MJX.xml"
"""

import argparse
import hashlib
from pathlib import Path
from typing import Tuple
import numpy as np
import mujoco
from PIL import Image

# Configuration
THUMBNAIL_SIZE = (320, 320)  # Small web-optimized size

# Default camera settings (programmatic camera, doesn't use XML camera definitions)
DEFAULT_CAMERA_DISTANCE = 3.0  # Distance from model
DEFAULT_CAMERA_AZIMUTH = 45  # Horizontal rotation angle in degrees
DEFAULT_CAMERA_ELEVATION = -20  # Vertical rotation angle in degrees (negative = looking down)
DEFAULT_CAMERA_LOOKAT = [0, 0, 1]  # Point to look at [x, y, z]

# Trajectory animation settings
TRAJECTORY_FRAMES = 30  # Number of frames in animation
ANIMATION_DURATION = 100  # ms per frame (10 fps)


class ThumbnailGenerator:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.models_dir = data_dir / "models"
        self.trajectories_dir = data_dir / "trajectories"
        self.thumbnails_dir = data_dir / "thumbnails"

        # Create thumbnail directories
        (self.thumbnails_dir / "models").mkdir(parents=True, exist_ok=True)
        (self.thumbnails_dir / "trajectories").mkdir(parents=True, exist_ok=True)

    def get_file_id(self, relative_path: str) -> str:
        """Generate MD5 hash ID for file (matches backend logic)

        Args:
            relative_path: Path relative to models/ or trajectories/ directory
                          e.g., "MS-Human-700/MS-Human-700-MJX.xml"
        """
        return hashlib.md5(relative_path.encode()).hexdigest()[:16]

    def render_with_camera(
        self,
        model: mujoco.MjModel,
        data: mujoco.MjData,
        camera_name: str = None,
        distance: float = None,
        azimuth: float = None,
        elevation: float = None,
        lookat: list = None
    ) -> np.ndarray:
        """Render a frame with the specified camera configuration

        Args:
            model: MuJoCo model
            data: MuJoCo data
            camera_name: Name of camera defined in XML (if None, uses custom parameters)
            distance: Camera distance (used if camera_name is None)
            azimuth: Camera azimuth angle (used if camera_name is None)
            elevation: Camera elevation angle (used if camera_name is None)
            lookat: Camera lookat point (used if camera_name is None)
        """
        # Create offscreen renderer
        renderer = mujoco.Renderer(model, THUMBNAIL_SIZE[1], THUMBNAIL_SIZE[0])

        if camera_name:
            # Use camera defined in XML
            try:
                camera_id = model.camera(camera_name).id
                print(f"  Using XML camera: {camera_name} (id={camera_id})")
                renderer.update_scene(data, camera=camera_id)
            except KeyError:
                print(f"  Warning: Camera '{camera_name}' not found in model, using custom parameters")
                # Fall back to custom parameters
                camera_name = None

        if not camera_name:
            # Set up camera programmatically with custom parameters
            camera = mujoco.MjvCamera()
            mujoco.mjv_defaultFreeCamera(model, camera)

            # Use provided parameters or defaults
            camera.distance = distance if distance is not None else DEFAULT_CAMERA_DISTANCE
            camera.azimuth = azimuth if azimuth is not None else DEFAULT_CAMERA_AZIMUTH
            camera.elevation = elevation if elevation is not None else DEFAULT_CAMERA_ELEVATION
            camera.lookat[:] = lookat if lookat is not None else DEFAULT_CAMERA_LOOKAT

            print(f"  Using custom camera: distance={camera.distance}, azimuth={camera.azimuth}, elevation={camera.elevation}")

            # Update scene with custom camera
            renderer.update_scene(data, camera=camera)

        # Render
        pixels = renderer.render()

        # Clean up
        renderer.close()

        return pixels

    def render_model(
        self,
        model_relative_path: str,
        camera_name: str = None,
        distance: float = None,
        azimuth: float = None,
        elevation: float = None,
        lookat: list = None
    ) -> bool:
        """Render thumbnail for ONE specific model

        Args:
            model_relative_path: Path relative to models/ directory
                                e.g., "MS-Human-700/MS-Human-700-MJX.xml"
            camera_name: Name of camera defined in XML (if provided, other params ignored)
            distance: Camera distance from model (used if camera_name not provided)
            azimuth: Horizontal rotation angle in degrees (used if camera_name not provided)
            elevation: Vertical rotation angle in degrees (used if camera_name not provided)
            lookat: Point to look at [x, y, z] (used if camera_name not provided)

        Returns:
            True if successful, False otherwise
        """

        model_path = self.models_dir / model_relative_path

        if not model_path.exists():
            print(f"Error: Model not found at {model_path}")
            return False

        if not model_path.suffix == '.xml':
            print(f"Error: File is not an XML file: {model_path}")
            return False

        try:
            # Get relative path for ID generation (MUST match backend's logic exactly)
            rel_path_str = model_relative_path  # Already relative to models/

            model_id = self.get_file_id(rel_path_str)

            # Create thumbnail path mirroring the model directory structure
            # e.g., data/thumbnails/models/MS-Human-700/abc123.webp
            rel_path = Path(model_relative_path)
            thumbnail_subdir = self.thumbnails_dir / "models" / rel_path.parent
            thumbnail_subdir.mkdir(parents=True, exist_ok=True)
            output_path = thumbnail_subdir / f"{model_id}.webp"

            print(f"Rendering model: {rel_path_str}")
            print(f"  Model ID: {model_id}")

            # Load model
            model = mujoco.MjModel.from_xml_path(str(model_path))
            data = mujoco.MjData(model)

            # Reset to initial state
            mujoco.mj_forward(model, data)

            # Render frame with camera
            pixels = self.render_with_camera(model, data, camera_name, distance, azimuth, elevation, lookat)

            # Save as WebP with compression
            img = Image.fromarray(pixels)
            img.save(output_path, "WEBP", quality=85, method=6)

            print(f"Saved to {output_path}")
            return True

        except Exception as e:
            print(f"Error: {e}")
            return False

    def render_trajectory(
        self,
        trajectory_path: Path,
        model_relative_path: str,
        camera_name: str = None,
        distance: float = None,
        azimuth: float = None,
        elevation: float = None,
        lookat: list = None
    ) -> bool:
        """Render animated WebP for a single trajectory

        Args:
            trajectory_path: Absolute path to trajectory file
            model_relative_path: Path relative to models/ directory
            camera_name: Name of camera defined in XML (if provided, other params ignored)
            distance: Camera distance from model (used if camera_name not provided)
            azimuth: Horizontal rotation angle in degrees (used if camera_name not provided)
            elevation: Vertical rotation angle in degrees (used if camera_name not provided)
            lookat: Point to look at [x, y, z] (used if camera_name not provided)

        Returns:
            True if successful, False otherwise
        """

        model_path = self.models_dir / model_relative_path

        if not model_path.exists():
            print(f"Error: Model not found at {model_path}")
            return False

        if not model_path.suffix == '.xml':
            print(f"Error: Model file is not an XML file: {model_path}")
            return False

        try:
            # Get relative path from trajectories directory for ID generation
            rel_path = trajectory_path.relative_to(self.trajectories_dir)
            rel_path_str = str(rel_path)  # e.g., "locomotion/walk.npy"

            trajectory_id = self.get_file_id(rel_path_str)

            # Create thumbnail path mirroring the trajectory directory structure
            # e.g., data/thumbnails/trajectories/locomotion/xyz789.webp
            thumbnail_subdir = self.thumbnails_dir / "trajectories" / rel_path.parent
            thumbnail_subdir.mkdir(parents=True, exist_ok=True)
            output_path = thumbnail_subdir / f"{trajectory_id}.webp"

            print(f"Rendering trajectory: {rel_path_str}")
            print(f"  Trajectory ID: {trajectory_id}")
            print(f"  Using model: {model_relative_path}")

            # Load model
            model = mujoco.MjModel.from_xml_path(str(model_path))
            data = mujoco.MjData(model)

            # Load trajectory data
            trajectory_data = np.load(trajectory_path)
            if isinstance(trajectory_data, np.lib.npyio.NpzFile):
                # NPZ file - get qpos array
                qpos_data = trajectory_data['qpos_traj']
            else:
                # NPY file
                qpos_data = trajectory_data

            total_frames = len(qpos_data)

            # Sample frames evenly across trajectory
            frame_indices = np.linspace(0, total_frames - 1, TRAJECTORY_FRAMES, dtype=int)

            # Render frames
            frames = []
            for idx in frame_indices:
                # Set qpos from trajectory
                data.qpos[:] = qpos_data[idx]
                mujoco.mj_forward(model, data)

                # Render frame with camera
                pixels = self.render_with_camera(model, data, camera_name, distance, azimuth, elevation, lookat)
                frames.append(pixels)

            # Save as WebP animation with compression
            pil_frames = [Image.fromarray(frame) for frame in frames]

            # Save as animated WebP
            pil_frames[0].save(
                output_path,
                "WEBP",
                save_all=True,
                append_images=pil_frames[1:],
                duration=ANIMATION_DURATION,
                loop=0,  # Infinite loop
                quality=85,
                method=6
            )

            print(f"Saved to {output_path}")
            return True

        except Exception as e:
            print(f"Error: {e}")
            return False

    def render_trajectories_in_folder(
        self,
        folder_relative_path: str,
        model_relative_path: str,
        camera_name: str = None,
        distance: float = None,
        azimuth: float = None,
        elevation: float = None,
        lookat: list = None
    ) -> Tuple[int, int]:
        """Render all trajectories in a folder

        Args:
            folder_relative_path: Path relative to trajectories/ directory
            model_relative_path: Path relative to models/ directory
            camera_name: Name of camera defined in XML (if provided, other params ignored)
            distance: Camera distance from model (used if camera_name not provided)
            azimuth: Horizontal rotation angle in degrees (used if camera_name not provided)
            elevation: Vertical rotation angle in degrees (used if camera_name not provided)
            lookat: Point to look at [x, y, z] (used if camera_name not provided)

        Returns:
            Tuple of (success_count, total_count)
        """
        folder_path = self.trajectories_dir / folder_relative_path

        if not folder_path.exists():
            print(f"Error: Folder not found at {folder_path}")
            return (0, 0)

        if not folder_path.is_dir():
            print(f"Error: Path is not a folder: {folder_path}")
            return (0, 0)

        # Find all trajectory files in the folder
        trajectory_files = list(folder_path.glob("*.npy")) + list(folder_path.glob("*.npz"))

        if not trajectory_files:
            print(f"Warning: No trajectory files (.npy/.npz) found in {folder_path}")
            return (0, 0)

        print(f"Found {len(trajectory_files)} trajectory file(s) in {folder_relative_path}")
        print()

        success_count = 0
        total_count = len(trajectory_files)

        for trajectory_file in trajectory_files:
            if self.render_trajectory(trajectory_file, model_relative_path, camera_name, distance, azimuth, elevation, lookat):
                success_count += 1
            print()  # Blank line between trajectories

        return (success_count, total_count)


def main():
    parser = argparse.ArgumentParser(
        description="Generate thumbnails for motion library (models and trajectories)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument("--data-dir", default="./data", help="Data directory path (default: ../data)")

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # render-model subcommand
    model_parser = subparsers.add_parser(
        "render-model",
        help="Render thumbnail for ONE specific model",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Render a model with default camera parameters
  python scripts/generate_thumbnails.py render-model --model "MS-Human-700/MS-Human-700-MJX.xml"

  # Render using a camera defined in the XML
  python scripts/generate_thumbnails.py render-model --model "MS-Human-700/MS-Human-700-MJX.xml" --camera "cam1"

  # Render with custom camera settings
  python scripts/generate_thumbnails.py render-model --model "MS-Human-700/MS-Human-700-MJX.xml" --distance 5.0 --azimuth 90 --elevation -30
        """
    )
    model_parser.add_argument(
        "--model",
        required=True,
        metavar="PATH",
        help="Model path relative to models/ directory (e.g., 'MS-Human-700/MS-Human-700-MJX.xml')"
    )
    model_parser.add_argument(
        "--camera",
        type=str,
        default=None,
        help="Camera name defined in XML (if not specified, uses custom camera parameters below)"
    )
    model_parser.add_argument(
        "--distance",
        type=float,
        default=None,
        help=f"Camera distance from model (default: {DEFAULT_CAMERA_DISTANCE}, ignored if --camera specified)"
    )
    model_parser.add_argument(
        "--azimuth",
        type=float,
        default=None,
        help=f"Camera azimuth angle in degrees (default: {DEFAULT_CAMERA_AZIMUTH}, ignored if --camera specified)"
    )
    model_parser.add_argument(
        "--elevation",
        type=float,
        default=None,
        help=f"Camera elevation angle in degrees (default: {DEFAULT_CAMERA_ELEVATION}, ignored if --camera specified)"
    )
    model_parser.add_argument(
        "--lookat",
        type=float,
        nargs=3,
        metavar=("X", "Y", "Z"),
        default=None,
        help=f"Camera lookat point [x y z] (default: {DEFAULT_CAMERA_LOOKAT}, ignored if --camera specified)"
    )

    # render-trajectory subcommand
    trajectory_parser = subparsers.add_parser(
        "render-trajectory",
        help="Render animation for trajectory (file or all in folder) with a specific model",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Render a single trajectory
  python scripts/generate_thumbnails.py render-trajectory --trajectory "locomotion/walk.npy" --model "MS-Human-700/MS-Human-700-MJX.xml"

  # Render all trajectories in a folder
  python scripts/generate_thumbnails.py render-trajectory --trajectory "locomotion/" --model "MS-Human-700/MS-Human-700-MJX.xml"

  # Render using a camera defined in the XML
  python scripts/generate_thumbnails.py render-trajectory --trajectory "locomotion/walk.npy" --model "MS-Human-700/MS-Human-700-MJX.xml" --camera "cam1"

  # Render with custom camera settings
  python scripts/generate_thumbnails.py render-trajectory --trajectory "locomotion/walk.npy" --model "MS-Human-700/MS-Human-700-MJX.xml" --distance 4.0
        """
    )
    trajectory_parser.add_argument(
        "--trajectory",
        required=True,
        metavar="PATH",
        help="Trajectory file or folder path relative to trajectories/ directory (e.g., 'locomotion/walk.npy' or 'locomotion/')"
    )
    trajectory_parser.add_argument(
        "--model",
        required=True,
        metavar="PATH",
        help="Model path relative to models/ directory (e.g., 'MS-Human-700/MS-Human-700-MJX.xml')"
    )
    trajectory_parser.add_argument(
        "--camera",
        type=str,
        default=None,
        help="Camera name defined in XML (if not specified, uses custom camera parameters below)"
    )
    trajectory_parser.add_argument(
        "--distance",
        type=float,
        default=None,
        help=f"Camera distance from model (default: {DEFAULT_CAMERA_DISTANCE}, ignored if --camera specified)"
    )
    trajectory_parser.add_argument(
        "--azimuth",
        type=float,
        default=None,
        help=f"Camera azimuth angle in degrees (default: {DEFAULT_CAMERA_AZIMUTH}, ignored if --camera specified)"
    )
    trajectory_parser.add_argument(
        "--elevation",
        type=float,
        default=None,
        help=f"Camera elevation angle in degrees (default: {DEFAULT_CAMERA_ELEVATION}, ignored if --camera specified)"
    )
    trajectory_parser.add_argument(
        "--lookat",
        type=float,
        nargs=3,
        metavar=("X", "Y", "Z"),
        default=None,
        help=f"Camera lookat point [x y z] (default: {DEFAULT_CAMERA_LOOKAT}, ignored if --camera specified)"
    )

    args = parser.parse_args()

    # Show help if no command specified
    if not args.command:
        parser.print_help()
        return

    data_dir = Path(args.data_dir).resolve()

    if not data_dir.exists():
        print(f"Error: Data directory not found: {data_dir}")
        print(f"Current working directory: {Path.cwd()}")
        print(f"Make sure you're running from the backend/ directory")
        return

    generator = ThumbnailGenerator(data_dir)

    if args.command == "render-model":
        # Render a single model
        success = generator.render_model(
            args.model,
            camera_name=args.camera,
            distance=args.distance,
            azimuth=args.azimuth,
            elevation=args.elevation,
            lookat=args.lookat
        )
        if success:
            print("\nModel thumbnail generated successfully")
        else:
            print("\nFailed to generate model thumbnail")

    elif args.command == "render-trajectory":
        # Check if trajectory path is a file or folder
        trajectory_path = generator.trajectories_dir / args.trajectory

        if trajectory_path.is_file():
            # Render single trajectory file
            success = generator.render_trajectory(
                trajectory_path,
                args.model,
                camera_name=args.camera,
                distance=args.distance,
                azimuth=args.azimuth,
                elevation=args.elevation,
                lookat=args.lookat
            )
            if success:
                print("\nTrajectory animation generated successfully")
            else:
                print("\nFailed to generate trajectory animation")

        elif trajectory_path.is_dir():
            # Render all trajectories in folder
            success_count, total_count = generator.render_trajectories_in_folder(
                args.trajectory,
                args.model,
                camera_name=args.camera,
                distance=args.distance,
                azimuth=args.azimuth,
                elevation=args.elevation,
                lookat=args.lookat
            )
            print(f"\nCompleted: {success_count}/{total_count} trajectory animations generated successfully")

        else:
            print(f"Error: Trajectory path not found: {trajectory_path}")
            print("Path must be a .npy/.npz file or a folder containing trajectory files")


if __name__ == "__main__":
    main()
