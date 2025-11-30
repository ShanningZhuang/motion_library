// MuJoCo WASM loader utility
// Based on reference implementation from mujoco_wasm/src/main.js

export type MuJoCoModule = any; // Will be typed by mujoco_wasm.d.ts

let mujocoInstance: MuJoCoModule | null = null;
let loadingPromise: Promise<MuJoCoModule> | null = null;

// Declare global initMuJoCo function from loader
declare global {
  interface Window {
    initMuJoCo?: () => Promise<any>;
  }
}

/**
 * Load and initialize the MuJoCo WASM module
 * Returns the same instance on subsequent calls (singleton pattern)
 */
export async function loadMuJoCo(): Promise<MuJoCoModule> {
  if (mujocoInstance) {
    return mujocoInstance;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      // Load the loader script if not already loaded
      if (typeof window !== 'undefined' && !window.initMuJoCo) {
        await loadScript('/wasm/loader.js');
      }

      // Wait a bit for the script to execute
      await new Promise(resolve => setTimeout(resolve, 100));

      if (!window.initMuJoCo) {
        throw new Error('MuJoCo loader not initialized');
      }

      // Get the loadMujoco function
      const loadMujocoWasm = await window.initMuJoCo();

      // Call it to initialize WASM
      const mujoco = await loadMujocoWasm();

      // Set up the virtual file system
      setupVirtualFS(mujoco);

      mujocoInstance = mujoco;
      return mujoco;
    } catch (error) {
      loadingPromise = null; // Reset on error
      console.error('Failed to load MuJoCo WASM:', error);
      throw new Error(`Failed to initialize MuJoCo WASM module: ${error}`);
    }
  })();

  return loadingPromise;
}

/**
 * Load a script tag
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.type = 'module';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Set up Emscripten's virtual file system
 * Creates the /working directory for storing model files
 */
export function setupVirtualFS(mujoco: MuJoCoModule): void {
  try {
    // Create working directory if it doesn't exist
    if (!mujoco.FS.analyzePath('/working').exists) {
      mujoco.FS.mkdir('/working');
      mujoco.FS.mount(mujoco.MEMFS, { root: '.' }, '/working');
    }
  } catch (error) {
    console.warn('Virtual filesystem already set up or error:', error);
  }
}

/**
 * Load a MuJoCo model from XML string
 * @param mujoco - The MuJoCo WASM module instance
 * @param xmlContent - XML content as string
 * @param filename - Name for the file in virtual FS (default: "model.xml")
 * @returns MuJoCo model and data objects
 */
export function loadModelFromXML(
  mujoco: MuJoCoModule,
  xmlContent: string,
  filename: string = 'model.xml'
): { model: any; data: any } {
  try {
    // Write XML to virtual filesystem
    const filepath = `/working/${filename}`;
    mujoco.FS.writeFile(filepath, xmlContent);

    // Load model from XML
    const model = mujoco.MjModel.mj_loadXML(filepath);
    const data = new mujoco.MjData(model);

    return { model, data };
  } catch (error) {
    console.error('Failed to load model from XML:', error);
    throw new Error(`Failed to load MuJoCo model: ${error}`);
  }
}

/**
 * Write a file to MuJoCo's virtual filesystem
 * Useful for loading model dependencies (meshes, textures, includes)
 */
export function writeFileToVFS(
  mujoco: MuJoCoModule,
  filepath: string,
  content: string | Uint8Array
): void {
  try {
    // Create directory structure if needed
    const parts = filepath.split('/').filter(p => p);
    let currentPath = '/working';

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += '/' + parts[i];
      if (!mujoco.FS.analyzePath(currentPath).exists) {
        mujoco.FS.mkdir(currentPath);
      }
    }

    // Write the file
    mujoco.FS.writeFile(filepath, content);
  } catch (error) {
    console.error(`Failed to write file ${filepath} to VFS:`, error);
    throw error;
  }
}

/**
 * Clean up MuJoCo model and data to prevent memory leaks
 */
export function cleanupModel(model: any, data: any): void {
  try {
    if (data && typeof data.delete === 'function') {
      data.delete();
    }
    if (model && typeof model.delete === 'function') {
      model.delete();
    }
  } catch (error) {
    console.error('Error cleaning up MuJoCo model:', error);
  }
}

/**
 * Create a default empty scene XML
 */
export function getDefaultSceneXML(): string {
  return `
<mujoco model="Empty">
  <visual>
    <rgba haze="0.15 0.25 0.35 1"/>
  </visual>

  <worldbody>
    <light directional="true" diffuse=".8 .8 .8" specular="0.2 0.2 0.2" pos="0 0 3" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="5 5 0.1" rgba="0.8 0.8 0.8 1"/>
    <body name="body" pos="0 0 0">
      <geom name="geom" type="sphere" size="0.1" rgba="1 0 0 1"/>
    </body>
  </worldbody>
</mujoco>
  `.trim();
}
