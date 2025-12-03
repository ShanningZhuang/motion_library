#!/usr/bin/env python3
"""
Generate thumbnails for models and animated GIFs for trajectories.

Usage:
    python scripts/generate_thumbnails.py --all
    python scripts/generate_thumbnails.py --models
    python scripts/generate_thumbnails.py --trajectories
    python scripts/generate_thumbnails.py --model-id <id>
    python scripts/generate_thumbnails.py --trajectory-id <id>
"""

import argparse
import hashlib
from pathlib import Path
from typing import Optional
import numpy as np
import mujoco
from PIL import Image
import imageio

# Configuration
THUMBNAIL_SIZE = (160, 160)  # Small web-optimized size
MODEL_CAMERA_DISTANCE = 3.0
TRAJECTORY_FRAMES = 30  # Number of frames in GIF
TRAJECTORY_FPS = 10  # GIF frame rate
GIF_DURATION = 100  # ms per frame (10 fps)


class ThumbnailGenerator:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.models_dir = data_dir / "models"
        self.trajectories_dir = data_dir / "trajectories"
        self.thumbnails_dir = data_dir / "thumbnails"

        # Create thumbnail directories
        (self.thumbnails_dir / "models").mkdir(parents=True, exist_ok=True)
        (self.thumbnails_dir / "trajectories").mkdir(parents=True, exist_ok=True)

    def get_file_id(self, file_path: Path) -> str:
        """Generate MD5 hash ID for file (matches backend logic)"""
        return hashlib.md5(str(file_path).encode()).hexdigest()[:16]

    def render_model_thumbnail(self, model_path: Path) -> np.ndarray:
        """Render a single frame of the model"""
        # Load model
        model = mujoco.MjModel.from_xml_path(str(model_path))
        data = mujoco.MjData(model)

        # Create offscreen renderer
        renderer = mujoco.Renderer(model, THUMBNAIL_SIZE[1], THUMBNAIL_SIZE[0])

        # Reset to initial state
        mujoco.mj_forward(model, data)

        # Position camera to frame the model
        renderer.update_scene(data, camera="free")

        # Render
        pixels = renderer.render()

        # Clean up
        renderer.close()

        return pixels

    def generate_model_thumbnail(self, model_path: Path) -> bool:
        """Generate PNG thumbnail for a model"""
        try:
            # Get relative path from models directory for ID generation
            rel_path = model_path.relative_to(self.models_dir)
            model_id = self.get_file_id(rel_path)
            output_path = self.thumbnails_dir / "models" / f"{model_id}.png"

            print(f"Generating thumbnail for {model_path.name}...")

            # Render frame
            pixels = self.render_model_thumbnail(model_path)

            # Save as PNG
            img = Image.fromarray(pixels)
            img.save(output_path, "PNG", optimize=True)

            print(f"  ✓ Saved to {output_path}")
            return True

        except Exception as e:
            print(f"  ✗ Error: {e}")
            return False

    def generate_trajectory_gif(self, model_path: Path, trajectory_path: Path) -> bool:
        """Generate animated GIF for a trajectory"""
        try:
            # Get relative path from trajectories directory for ID generation
            rel_path = trajectory_path.relative_to(self.trajectories_dir)
            trajectory_id = self.get_file_id(rel_path)
            output_path = self.thumbnails_dir / "trajectories" / f"{trajectory_id}.gif"

            print(f"Generating GIF for {trajectory_path.name}...")

            # Load model
            model = mujoco.MjModel.from_xml_path(str(model_path))
            data = mujoco.MjData(model)

            # Load trajectory data
            trajectory_data = np.load(trajectory_path)
            if isinstance(trajectory_data, np.lib.npyio.NpzFile):
                # NPZ file - get qpos array
                qpos_data = trajectory_data['qpos']
            else:
                # NPY file
                qpos_data = trajectory_data

            total_frames = len(qpos_data)

            # Sample frames evenly across trajectory
            frame_indices = np.linspace(0, total_frames - 1, TRAJECTORY_FRAMES, dtype=int)

            # Create offscreen renderer
            renderer = mujoco.Renderer(model, THUMBNAIL_SIZE[1], THUMBNAIL_SIZE[0])

            # Render frames
            frames = []
            for idx in frame_indices:
                # Set qpos from trajectory
                data.qpos[:] = qpos_data[idx]
                mujoco.mj_forward(model, data)

                # Render
                renderer.update_scene(data, camera="free")
                pixels = renderer.render()
                frames.append(pixels)

            # Clean up
            renderer.close()

            # Save as GIF
            imageio.mimsave(
                output_path,
                frames,
                duration=GIF_DURATION,
                loop=0  # Infinite loop
            )

            print(f"  ✓ Saved to {output_path}")
            return True

        except Exception as e:
            print(f"  ✗ Error: {e}")
            return False

    def generate_all_models(self) -> None:
        """Generate thumbnails for all models"""
        print("Generating model thumbnails...")

        success_count = 0
        total_count = 0

        for model_file in self.models_dir.rglob("*.xml"):
            total_count += 1
            if self.generate_model_thumbnail(model_file):
                success_count += 1

        print(f"\nCompleted: {success_count}/{total_count} model thumbnails generated")

    def generate_all_trajectories(self) -> None:
        """Generate GIFs for all trajectories (requires matching model)"""
        print("Generating trajectory GIFs...")

        # For now, use first available model as default
        # TODO: Implement model-trajectory matching logic
        default_model = next(self.models_dir.rglob("*.xml"), None)

        if not default_model:
            print("Error: No model found for trajectory rendering")
            return

        print(f"Using model: {default_model.name}")

        success_count = 0
        total_count = 0

        for trajectory_file in self.trajectories_dir.rglob("*.np[yz]"):
            total_count += 1
            if self.generate_trajectory_gif(default_model, trajectory_file):
                success_count += 1

        print(f"\nCompleted: {success_count}/{total_count} trajectory GIFs generated")


def main():
    parser = argparse.ArgumentParser(description="Generate thumbnails for motion library")
    parser.add_argument("--all", action="store_true", help="Generate all thumbnails")
    parser.add_argument("--models", action="store_true", help="Generate model thumbnails")
    parser.add_argument("--trajectories", action="store_true", help="Generate trajectory GIFs")
    parser.add_argument("--model-id", help="Generate thumbnail for specific model ID")
    parser.add_argument("--trajectory-id", help="Generate GIF for specific trajectory ID")
    parser.add_argument("--data-dir", default="data", help="Data directory path")

    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    generator = ThumbnailGenerator(data_dir)

    if args.all:
        generator.generate_all_models()
        generator.generate_all_trajectories()
    elif args.models:
        generator.generate_all_models()
    elif args.trajectories:
        generator.generate_all_trajectories()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
