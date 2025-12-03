// Wrapper to load MuJoCo WASM and expose it globally
// This file loads the mujoco_wasm.js module and makes it available

let mujocoLoaderPromise = null;

async function initMuJoCo() {
  if (mujocoLoaderPromise) {
    return mujocoLoaderPromise;
  }

  mujocoLoaderPromise = (async () => {
    // Import the MuJoCo WASM module
    const module = await import('./mujoco_wasm.js');
    return module.default;
  })();

  return mujocoLoaderPromise;
}

// Expose globally
window.initMuJoCo = initMuJoCo;
