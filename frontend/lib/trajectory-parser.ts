/**
 * Trajectory file parser for NPY and NPZ formats
 * Handles loading and parsing of motion capture data
 */

import { load as loadNpy, type NpyArray } from 'npyjs';
import { unzipSync } from 'fflate';

export interface TrajectoryData {
  qpos: Float64Array[];  // Array of qpos arrays, one per frame
  frameRate: number;     // Frames per second
  frameCount: number;    // Total number of frames
}

/**
 * Parse NPY file (single array format)
 * Expected shape: [time, qpos]
 */
export async function parseNPY(blob: Blob): Promise<TrajectoryData> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const npyData: NpyArray = await loadNpy(arrayBuffer);

    const data = npyData.data as Float64Array;
    const shape = npyData.shape;

    if (shape.length !== 2) {
      throw new Error(`Invalid NPY shape: expected [time, qpos], got [${shape.join(', ')}]`);
    }

    const [frameCount, qposSize] = shape;

    // Split flat array into frames
    const qpos: Float64Array[] = [];
    for (let i = 0; i < frameCount; i++) {
      const start = i * qposSize;
      const end = start + qposSize;
      qpos.push(data.slice(start, end));
    }

    // Default framerate for NPY files (no metadata)
    const frameRate = 30;

    console.log(`Parsed NPY trajectory: ${frameCount} frames, ${qposSize} qpos dimensions, ${frameRate} fps`);

    return {
      qpos,
      frameRate,
      frameCount
    };
  } catch (error) {
    console.error('Error parsing NPY file:', error);
    throw new Error(`Failed to parse NPY trajectory: ${error}`);
  }
}

/**
 * Parse NPZ file (zipped numpy archive)
 * Expected to contain:
 * - A key starting with 'qpos' (e.g., 'qpos', 'qpos_traj', 'qpos.npy'): array with shape [time, qpos]
 * - 'framerate' or 'frame_rate': scalar or single value (optional, defaults to 30)
 */
export async function parseNPZ(blob: Blob): Promise<TrajectoryData> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Unzip the NPZ file
    const unzipped = unzipSync(uint8Array);

    // Find qpos file - look for any key starting with "qpos"
    // This supports: qpos_traj, qpos_traj.npy, qpos, qpos.npy, etc.
    const qposTrajKey = Object.keys(unzipped).find(k => {
      const keyName = k.replace('.npy', ''); // Remove .npy extension if present
      return keyName.startsWith('qpos');
    });
    
    if (!qposTrajKey) {
      const availableKeys = Object.keys(unzipped).join(', ');
      throw new Error(`NPZ file must contain a "qpos" array (keys starting with "qpos"). Available keys: ${availableKeys}`);
    }
    
    console.log(`[TRAJECTORY PARSER] Found qpos data with key: ${qposTrajKey}`);

    // Parse qpos trajectory
    const npyData: NpyArray = await loadNpy(unzipped[qposTrajKey]);

    const data = npyData.data as Float64Array;
    const shape = npyData.shape;

    if (shape.length !== 2) {
      throw new Error(`Invalid qpos_traj shape: expected [time, qpos], got [${shape.join(', ')}]`);
    }

    const [frameCount, qposSize] = shape;

    // Split flat array into frames
    const qpos: Float64Array[] = [];
    for (let i = 0; i < frameCount; i++) {
      const start = i * qposSize;
      const end = start + qposSize;
      qpos.push(data.slice(start, end));
    }

    // Try to extract framerate
    let frameRate = 30; // default
    const framerateKey = Object.keys(unzipped).find(k =>
      k === 'framerate.npy' || k === 'framerate' || k === 'frame_rate.npy' || k === 'frame_rate'
    );

    if (framerateKey) {
      try {
        const frData: NpyArray = await loadNpy(unzipped[framerateKey]);
        const frArray = frData.data as Float64Array;
        frameRate = frArray[0];
      } catch (error) {
        console.warn('Could not parse framerate from NPZ, using default 30 fps');
      }
    }

    console.log(`Parsed NPZ trajectory: ${frameCount} frames, ${qposSize} qpos dimensions, ${frameRate} fps`);

    return {
      qpos,
      frameRate,
      frameCount
    };
  } catch (error) {
    console.error('Error parsing NPZ file:', error);
    throw new Error(`Failed to parse NPZ trajectory: ${error}`);
  }
}

/**
 * Auto-detect format and parse trajectory file
 */
export async function parseTrajectory(blob: Blob, filename?: string): Promise<TrajectoryData> {
  // Try to detect format from filename
  if (filename) {
    if (filename.endsWith('.npy')) {
      return parseNPY(blob);
    } else if (filename.endsWith('.npz')) {
      return parseNPZ(blob);
    }
  }

  // Try to detect from file signature
  const header = new Uint8Array(await blob.slice(0, 10).arrayBuffer());

  // NPY magic number: 0x93NUMPY
  if (header[0] === 0x93 &&
      String.fromCharCode(header[1]) === 'N' &&
      String.fromCharCode(header[2]) === 'U' &&
      String.fromCharCode(header[3]) === 'M' &&
      String.fromCharCode(header[4]) === 'P' &&
      String.fromCharCode(header[5]) === 'Y') {
    console.log('Detected NPY format from file signature');
    return parseNPY(blob);
  }

  // ZIP magic number: PK (0x504B) - NPZ files are ZIP archives
  if (header[0] === 0x50 && header[1] === 0x4B) {
    console.log('Detected NPZ format from file signature');
    return parseNPZ(blob);
  }

  throw new Error('Unknown trajectory file format. Expected .npy or .npz file');
}
