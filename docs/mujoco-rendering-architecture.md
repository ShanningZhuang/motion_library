# MuJoCo Rendering Architecture

This document explains how the Motion Library loads, renders, and animates MuJoCo models and trajectories.

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Loading Pipeline](#loading-pipeline)
4. [Rendering Pipeline](#rendering-pipeline)
5. [Animation System](#animation-system)
6. [Multi-Trajectory System](#multi-trajectory-system)
7. [Code Structure](#code-structure)
8. [Data Flow](#data-flow)

---

## Overview

The Motion Library uses a hybrid approach combining:
- **MuJoCo WASM** - Physics simulation and forward kinematics
- **THREE.js** - 3D rendering and scene management
- **React** - UI state management and component lifecycle

### Key Concepts

- **Model**: MuJoCo XML definition + compiled binary model
- **Trajectory**: Sequence of joint positions (qpos) over time
- **Body**: Kinematic link in the robot (e.g., forearm, hand)
- **Geometry**: Visual shapes attached to bodies (meshes, primitives)
- **Scene Graph**: Hierarchical tree structure for 3D objects

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         React UI Layer                          │
│                    (visualize/page.tsx)                         │
│                                                                 │
│  State Management:                                              │
│  - selectedModelXML: string                                     │
│  - loadedTrajectories: LoadedTrajectory[]                       │
│  - currentFrame: number                                         │
│  - playing: boolean                                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MuJoCoViewer Component                       │
│                  (components/MuJoCoViewer.tsx)                  │
│                                                                 │
│  Responsibilities:                                              │
│  - Initialize MuJoCo WASM                                       │
│  - Create THREE.js scene                                        │
│  - Manage trajectory bodies                                     │
│  - Run animation loop                                           │
│  - Handle video recording                                       │
└────────────┬────────────────────────────┬─────────────────────┘
             │                            │
             ▼                            ▼
┌─────────────────────────┐  ┌──────────────────────────────────┐
│   MuJoCo WASM Module    │  │      THREE.js Renderer           │
│  (mujoco_wasm.wasm)     │  │  (WebGLRenderer + Scene)         │
│                         │  │                                  │
│  - Load model XML       │  │  - Render scene graph            │
│  - Compile to binary    │  │  - Handle cameras/lights         │
│  - mj_forward() - FK    │  │  - OrbitControls                 │
│  - Compute body poses   │  │  - Shadow mapping                │
│  - Compute geom poses   │  │  - Anti-aliasing                 │
└─────────────────────────┘  └──────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MuJoCo Utilities                             │
│                   (lib/mujoco-utils.ts)                         │
│                                                                 │
│  Core Functions:                                                │
│  - loadMuJoCoScene() - Convert MuJoCo → THREE.js                │
│  - applyQposAndUpdateBodies() - Update body transforms          │
│  - createGhostBodies() - Clone with transparency                │
│  - drawTendonsAndFlex() - Render tendons/cables                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Loading Pipeline

### Step 1: Model Loading

**File**: `frontend/components/MuJoCoViewer.tsx` (lines 628-780)

```typescript
// 1. User selects model → ModelSelector provides XML string
<MuJoCoViewer modelXML={selectedModelXML} />

// 2. MuJoCoViewer receives XML and initializes MuJoCo
useEffect(() => {
  const initMuJoCo = async () => {
    // Load MuJoCo WASM module
    const mujoco = await load_mujoco();

    // Parse XML and create model
    const model = mujoco.Model.load_from_xml(modelXML);

    // Create data instance (state container)
    const data = new mujoco.Data(model);

    // Store in refs
    mujocoRef.current = mujoco;
    modelRef.current = model;
    dataRef.current = data;
  };
}, [modelXML]);
```

**What happens**:
1. MuJoCo WASM compiles XML → binary model
2. Model contains: joint definitions, body hierarchy, geometry specs
3. Data instance created: holds current state (qpos, velocities, forces)

### Step 2: Scene Creation

**File**: `frontend/lib/mujoco-utils.ts` (lines 263-446)

```typescript
export function loadMuJoCoScene(
  mujoco: any,
  model: any,
  meshDir?: string
): { mujocoRoot: THREE.Group; bodies: (THREE.Group | null)[]; meshes: THREE.Mesh[] }
```

**Process**:

```
MuJoCo Model
     │
     ├─→ Parse Bodies (model.nbody)
     │     │
     │     ├─→ Create THREE.Group for each body
     │     │     └─→ Name: model.names[nameadr]
     │     │
     │     └─→ Parse Geometries (model.ngeom)
     │           │
     │           ├─→ Sphere → THREE.SphereGeometry
     │           ├─→ Box → THREE.BoxGeometry
     │           ├─→ Cylinder → THREE.CylinderGeometry
     │           ├─→ Capsule → Custom geometry
     │           ├─→ Mesh → Load .stl/.obj from meshDir
     │           └─→ Plane → THREE.PlaneGeometry
     │
     ├─→ Create Materials
     │     └─→ MeshPhongMaterial (for lighting)
     │           ├─→ color: from model.geom_rgba
     │           ├─→ specular: model.geom_matid → mat_specular
     │           └─→ shininess: model.geom_matid → mat_shininess
     │
     ├─→ Apply Local Transforms
     │     └─→ Mesh position/rotation relative to body
     │           (from model.geom_pos, model.geom_quat)
     │
     ├─→ Create Tendon Rendering
     │     ├─→ Cylinders: THREE.InstancedMesh (tendon segments)
     │     └─→ Spheres: THREE.InstancedMesh (tendon endpoints)
     │
     └─→ Build Scene Hierarchy
           └─→ mujocoRoot (THREE.Group)
                 ├─→ bodies[0] (world body)
                 │     ├─→ bodies[1] (child links...)
                 │     └─→ bodies[n]
                 ├─→ cylinders (InstancedMesh)
                 └─→ spheres (InstancedMesh)
```

**Key Output**:
```typescript
{
  mujocoRoot: THREE.Group,     // Scene root container
  bodies: THREE.Group[],       // Array of body groups (indexed by body ID)
  meshes: THREE.Mesh[]         // Flat array of all geometry meshes
}
```

### Step 3: Default Pose Initialization

**File**: `frontend/components/MuJoCoViewer.tsx` (lines 747-775)

```typescript
// After creating scene, set bodies to default pose (qpos0)
mujoco.mj_forward(model, data);

for (let b = 0; b < model.nbody; b++) {
  if (bodies[b]) {
    // Read computed body position/orientation from MuJoCo
    const pos = new THREE.Vector3(
      data.xpos[b * 3 + 0],
      data.xpos[b * 3 + 1],
      data.xpos[b * 3 + 2]
    );

    const quat = new THREE.Quaternion(
      data.xquat[b * 4 + 1],  // x
      data.xquat[b * 4 + 2],  // y
      data.xquat[b * 4 + 3],  // z
      data.xquat[b * 4 + 0]   // w
    );

    bodies[b].position.copy(pos);
    bodies[b].quaternion.copy(quat);
    bodies[b].updateWorldMatrix(false, false);
  }
}
```

**Why needed**: After scene creation, bodies are at arbitrary positions. This initializes them to the model's default configuration (qpos0).

---

## Rendering Pipeline

### THREE.js Scene Hierarchy

```
Scene (THREE.Scene)
  │
  ├─→ Lights
  │     ├─→ AmbientLight (0x404040)
  │     ├─→ DirectionalLight (with shadows)
  │     └─→ PointLight
  │
  ├─→ mujocoRoot (THREE.Group) - Original model
  │     ├─→ bodies[0] (world)
  │     │     ├─→ Mesh (ground plane)
  │     │     ├─→ bodies[1] (torso)
  │     │     │     ├─→ Mesh (torso visual)
  │     │     │     ├─→ bodies[2] (left_shoulder)
  │     │     │     │     ├─→ Mesh (shoulder visual)
  │     │     │     │     └─→ bodies[3] (left_elbow)
  │     │     │     │           └─→ Mesh (forearm visual)
  │     │     │     └─→ bodies[...] (right_shoulder...)
  │     │     └─→ ...
  │     ├─→ cylinders (InstancedMesh) - Tendon segments
  │     └─→ spheres (InstancedMesh) - Tendon endpoints
  │
  ├─→ Trajectory_1 (THREE.Group) - First loaded trajectory
  │     └─→ Cloned bodies (normal or ghost materials)
  │
  ├─→ Trajectory_2 (THREE.Group) - Second loaded trajectory
  │     └─→ Cloned bodies (normal or ghost materials)
  │
  └─→ ...
```

### Coordinate Systems

**MuJoCo**: Right-handed Z-up
- X: right
- Y: forward
- Z: up

**THREE.js**: Right-handed Y-up (default)
- X: right
- Y: up
- Z: backward (toward camera)

**Current Implementation**: Uses MuJoCo's Z-up directly (swizzle = false)

### Rendering Loop

**File**: `frontend/components/MuJoCoViewer.tsx` (lines 842-886)

```typescript
const animate = () => {
  requestAnimationFrame(animate);

  // 1. Update trajectory bodies based on currentFrame
  trajectories.forEach((traj, index) => {
    const entry = trajectoryBodiesMap.current.get(traj.id);
    if (!entry) return;

    const frameIndex = Math.min(currentFrameRef.current, traj.data.qpos.length - 1);
    const qposData = traj.data.qpos[frameIndex];

    // Update body transforms
    applyQposAndUpdateBodies(
      qposData,
      mujocoRef.current,
      modelRef.current,
      entry.data,
      entry.bodies,
      undefined,  // Don't render tendons on trajectory clones
      false       // swizzle = false
    );
  });

  // 2. Update controls (orbit camera)
  if (controlsRef.current) {
    controlsRef.current.update();
  }

  // 3. Render scene
  if (rendererRef.current && sceneRef.current && activeCameraRef.current) {
    rendererRef.current.render(sceneRef.current, activeCameraRef.current);
  }
};
```

---

## Animation System

### Frame-Based Playback

**File**: `frontend/app/visualize/page.tsx` (lines 46-89)

```typescript
// Playback state
const [playing, setPlaying] = useState(false);
const [currentFrame, setCurrentFrame] = useState(0);
const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

// Find longest trajectory
const maxFrameCount = loadedTrajectories.reduce((max, traj) =>
  Math.max(max, traj.data.frameCount), 0);

const primaryFrameRate = loadedTrajectories[0]?.data.frameRate || 30;

// Animation loop
useEffect(() => {
  if (!playing || loadedTrajectories.length === 0) return;

  let animationFrameId: number;
  lastFrameTimeRef.current = performance.now();

  const advanceFrame = (currentTime: number) => {
    // Calculate time delta
    const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000;
    lastFrameTimeRef.current = currentTime;

    // Calculate frame delta based on framerate and speed
    const frameDelta = deltaTime * primaryFrameRate * playbackSpeed;

    setCurrentFrame(prevFrame => {
      const nextFrame = prevFrame + frameDelta;

      // Stop at end
      if (nextFrame >= maxFrameCount - 1) {
        setPlaying(false);
        return maxFrameCount - 1;
      }

      return nextFrame;
    });

    animationFrameId = requestAnimationFrame(advanceFrame);
  };

  animationFrameId = requestAnimationFrame(advanceFrame);

  return () => cancelAnimationFrame(animationFrameId);
}, [playing, playbackSpeed, loadedTrajectories, maxFrameCount, primaryFrameRate]);
```

### Frame Synchronization

**How it works**:
1. `currentFrame` is a **float** (e.g., 42.7) for smooth interpolation
2. When rendering, floor to get integer index: `Math.floor(currentFrame)`
3. All trajectories share the same `currentFrame`
4. Each trajectory independently looks up its qpos at that frame index
5. If trajectory is shorter, it clamps to last frame

**Example**:
```
currentFrame = 100

Trajectory 1 (500 frames): Shows frame 100
Trajectory 2 (80 frames):  Shows frame 79 (clamped)
Trajectory 3 (200 frames): Shows frame 100
```

### Body Transform Updates

**File**: `frontend/lib/mujoco-utils.ts` (lines 460-500)

```typescript
export function applyQposAndUpdateBodies(
  qpos: Float64Array,        // Joint positions for this frame
  mujoco: any,               // MuJoCo WASM module
  model: any,                // MuJoCo model
  data: any,                 // MuJoCo data instance (per-trajectory)
  bodies: THREE.Group[],     // THREE.js body groups (per-trajectory)
  mujocoRoot?: THREE.Group,  // Root for tendon rendering (optional)
  swizzle: boolean = false   // Coordinate conversion
): void {
  // 1. Copy qpos to MuJoCo data
  for (let i = 0; i < qpos.length; i++) {
    data.qpos[i] = qpos[i];
  }

  // 2. Compute forward kinematics
  // This computes body positions/orientations from joint angles
  mujoco.mj_forward(model, data);

  // Now data.xpos and data.xquat contain world-space body transforms

  // 3. Update THREE.js body transforms
  for (let b = 0; b < model.nbody; b++) {
    const body = bodies[b];
    if (body) {
      // Read from MuJoCo computed data
      getPosition(data.xpos, b, body.position, swizzle);
      getQuaternion(data.xquat, b, body.quaternion, swizzle);

      // Update world matrix (propagates to children)
      body.updateWorldMatrix(false, false);
    }
  }

  // 4. Optionally render tendons (only on original model)
  if (mujocoRoot) {
    drawTendonsAndFlex(mujocoRoot, model, data, swizzle);
  }
}
```

### Why We Use Body-Level Updates (Not Geometry-Level)

**Current approach**: Update bodies → meshes inherit transforms
```
Body (THREE.Group) ← Updated from data.xpos/data.xquat
  └─→ Mesh 1 (local offset: [0.1, 0, 0])
  └─→ Mesh 2 (local offset: [0, 0.2, 0])
  └─→ Mesh 3 (local offset: [-0.1, 0, 0])
```

**Alternative approach**: Update each mesh directly from `data.geom_xpos`/`data.geom_xmat`
```
Mesh 1 ← Updated from data.geom_xpos[geom_id_1]
Mesh 2 ← Updated from data.geom_xpos[geom_id_2]
Mesh 3 ← Updated from data.geom_xpos[geom_id_3]
```

**Why body-based is used**:
1. **Hierarchical organization**: Bodies are logical units (e.g., "hand" contains 5 finger geometries)
2. **Matches MuJoCo structure**: MuJoCo's kinematic tree is body-centric
3. **Easier management**: Can hide/show entire bodies, apply effects to all geometries
4. **Scene graph benefits**: Traversal, grouping, and organization

**Trade-off**: Geometry-based would be simpler (no intermediate Groups) but loses organizational structure.

---

## Multi-Trajectory System

### Data Structure

**File**: `frontend/app/visualize/page.tsx` (lines 16-22)

```typescript
interface LoadedTrajectory {
  id: string;                    // Unique identifier (timestamp or UUID)
  name: string;                  // Display name (filename)
  data: TrajectoryData;          // Parsed qpos data
  isGhost: boolean;              // Render as semi-transparent
  source: 'server' | 'local';    // Where it came from
}
```

**File**: `frontend/lib/trajectory-parser.ts`

```typescript
interface TrajectoryData {
  qpos: Float64Array[];     // Array of joint positions [frame][joint]
  frameCount: number;       // Number of frames
  frameRate: number;        // FPS (default: 30)
  jointCount: number;       // Number of joints (nq)
}
```

### Trajectory Bodies Management

**File**: `frontend/components/MuJoCoViewer.tsx` (lines 220-314)

```typescript
// Map: trajectory ID → { bodies, data, root }
const trajectoryBodiesMap = useRef<Map<string, {
  bodies: (THREE.Group | null)[];  // Cloned body groups
  data: any;                        // MuJoCo data instance
  root: THREE.Group;                // Scene group container
}>>(new Map());

useEffect(() => {
  if (!modelRef.current || !mujocoRef.current || !sceneRef.current) return;

  // 1. Remove trajectories no longer in list
  const neededIds = new Set(trajectories.map(t => t.id));
  trajectoryBodiesMap.current.forEach((entry, id) => {
    if (!neededIds.has(id)) {
      sceneRef.current?.remove(entry.root);
      trajectoryBodiesMap.current.delete(id);
    }
  });

  // 2. Add new trajectories
  trajectories.forEach(traj => {
    if (!trajectoryBodiesMap.current.has(traj.id)) {
      // Clone bodies from original
      const bodiesArray = Object.values(bodiesRef.current);
      const bodies = traj.isGhost
        ? createGhostBodies(bodiesArray)
        : bodiesArray.map(b => b?.clone(true) ?? null);

      // Create independent MuJoCo data instance
      const data = new mujocoRef.current!.Data(modelRef.current);

      // Create scene group
      const root = new THREE.Group();
      root.name = `Trajectory_${traj.id}`;
      bodies.forEach(body => body && root.add(body));
      sceneRef.current!.add(root);

      // Store
      trajectoryBodiesMap.current.set(traj.id, { bodies, data, root });
    }
  });

  // 3. Update ghost appearance when isGhost changes
  trajectories.forEach(traj => {
    const entry = trajectoryBodiesMap.current.get(traj.id);
    if (entry) {
      entry.root.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshPhongMaterial) {
          if (traj.isGhost) {
            obj.material.transparent = true;
            obj.material.opacity = 0.35;
            obj.material.depthWrite = false;
            obj.renderOrder = -1;
          } else {
            obj.material.transparent = false;
            obj.material.opacity = 1.0;
            obj.material.depthWrite = true;
            obj.renderOrder = 0;
          }
        }
      });
    }
  });

  // 4. Hide/show original bodies
  if (mujocoRootRef.current) {
    mujocoRootRef.current.visible = trajectories.length === 0;
  }

}, [trajectories, modelRef.current, mujocoRef.current, sceneRef.current]);
```

### Ghost Mode

**File**: `frontend/lib/mujoco-utils.ts` (lines 511-550)

```typescript
export function createGhostBodies(
  sourceBodies: (THREE.Group | null)[],
  ghostColor: number = 0x4488ff,
  opacity: number = 0.35
): (THREE.Group | null)[] {
  const ghostBodies: (THREE.Group | null)[] = [];

  for (let b = 0; b < sourceBodies.length; b++) {
    if (!sourceBodies[b]) {
      ghostBodies[b] = null;
      continue;
    }

    // Deep clone body group
    const ghostBody = sourceBodies[b]!.clone(true);
    ghostBody.name = sourceBodies[b]!.name + '_ghost';

    // Update all mesh materials
    ghostBody.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const ghostMaterial = (obj.material as THREE.Material).clone();

        if (ghostMaterial instanceof THREE.MeshPhongMaterial) {
          ghostMaterial.color.setHex(ghostColor);
          ghostMaterial.transparent = true;
          ghostMaterial.opacity = opacity;
          ghostMaterial.depthWrite = false;  // Prevent z-fighting
        }

        obj.material = ghostMaterial;
        obj.renderOrder = -1;  // Render before opaque objects
      }
    });

    ghostBodies[b] = ghostBody;
  }

  return ghostBodies;
}
```

**Rendering order**:
1. Ghost trajectories (renderOrder = -1, transparent)
2. Normal trajectories (renderOrder = 0, opaque)
3. UI overlays

### Why Each Trajectory Needs Its Own MuJoCo Data Instance

```typescript
// Each trajectory gets its own data instance
const data = new mujocoRef.current.Data(modelRef.current);
```

**Reason**: `mj_forward()` is stateful. It reads from `data.qpos` and writes computed results to `data.xpos`, `data.xquat`, etc.

**If we shared one data instance**:
```typescript
// BAD: All trajectories overwrite same data
for (const traj of trajectories) {
  applyQposAndUpdateBodies(traj.qpos[frame], ..., sharedData, ...);
  // Each call overwrites data.xpos/data.xquat!
  // Only the last trajectory would render correctly
}
```

**With separate instances**:
```typescript
// GOOD: Each trajectory has independent computation
for (const traj of trajectories) {
  const entry = trajectoryBodiesMap.get(traj.id);
  applyQposAndUpdateBodies(traj.qpos[frame], ..., entry.data, ...);
  // entry.data is unique to this trajectory ✓
}
```

---

## Code Structure

### File Organization

```
frontend/
├── app/
│   └── visualize/
│       └── page.tsx                    # Main visualization page
│                                       # - State management
│                                       # - Trajectory loading
│                                       # - Playback controls
│
├── components/
│   ├── MuJoCoViewer.tsx               # Core viewer component
│   │                                   # - MuJoCo initialization
│   │                                   # - Scene management
│   │                                   # - Animation loop
│   │                                   # - Video recording
│   │
│   ├── TrajectoryList.tsx             # Loaded trajectories UI
│   │                                   # - Display list
│   │                                   # - Ghost toggle
│   │                                   # - Remove button
│   │
│   ├── TrajectorySelector.tsx         # Server trajectory picker
│   ├── TrajectoryUpload.tsx           # Local file upload
│   ├── ModelSelector.tsx              # Model picker
│   ├── ViewerOptions.tsx              # Axes toggles, etc.
│   └── VideoControls.tsx              # Camera + recording
│
└── lib/
    ├── mujoco-utils.ts                # Core rendering utilities
    │                                   # - loadMuJoCoScene()
    │                                   # - applyQposAndUpdateBodies()
    │                                   # - createGhostBodies()
    │                                   # - drawTendonsAndFlex()
    │
    ├── trajectory-parser.ts           # Parse .npy/.npz files
    │                                   # - Supports NumPy format
    │
    ├── streaming-recorder.ts          # Video recording (WebM)
    │                                   # - Frame-by-frame capture
    │                                   # - MediaRecorder API
    │
    └── api.ts                         # Backend API calls
                                        # - Fetch models
                                        # - Fetch trajectories
```

### Key Functions Reference

#### `loadMuJoCoScene()`
**File**: `frontend/lib/mujoco-utils.ts` (lines 263-446)

**Purpose**: Convert MuJoCo model to THREE.js scene

**Parameters**:
- `mujoco` - MuJoCo WASM module
- `model` - Compiled MuJoCo model
- `meshDir` - Optional directory for external meshes

**Returns**:
```typescript
{
  mujocoRoot: THREE.Group,        // Scene root container
  bodies: (THREE.Group | null)[], // Body groups (indexed by body ID)
  meshes: THREE.Mesh[]            // Flat array of meshes
}
```

**What it does**:
1. Creates THREE.Group for each body
2. Parses geometries and creates THREE.Mesh objects
3. Creates materials from MuJoCo material properties
4. Applies local geometry transforms
5. Creates instanced meshes for tendons/flex
6. Builds scene hierarchy

---

#### `applyQposAndUpdateBodies()`
**File**: `frontend/lib/mujoco-utils.ts` (lines 460-500)

**Purpose**: Update body transforms for a given qpos

**Parameters**:
- `qpos` - Joint positions array (length = model.nq)
- `mujoco` - MuJoCo WASM module
- `model` - MuJoCo model
- `data` - MuJoCo data instance (per-trajectory)
- `bodies` - Array of THREE.js body groups
- `mujocoRoot` - Optional root for tendon rendering
- `swizzle` - Coordinate conversion flag (default: false)

**What it does**:
1. Copies qpos to `data.qpos`
2. Calls `mj_forward()` to compute forward kinematics
3. Reads computed body transforms from `data.xpos` and `data.xquat`
4. Updates THREE.js body positions and quaternions
5. Optionally updates tendon rendering (if mujocoRoot provided)

**Critical detail**: This is called every frame for every trajectory

---

#### `createGhostBodies()`
**File**: `frontend/lib/mujoco-utils.ts` (lines 511-550)

**Purpose**: Clone bodies with semi-transparent appearance

**Parameters**:
- `sourceBodies` - Original body groups
- `ghostColor` - Color for ghost (default: 0x4488ff blue)
- `opacity` - Transparency level (default: 0.35)

**Returns**: Cloned body array with ghost materials

**What it does**:
1. Deep clones each body group
2. Traverses all meshes in the clone
3. Clones materials (to avoid modifying originals)
4. Sets transparency, color, and render order
5. Disables depth writing (prevents z-fighting)

---

#### `drawTendonsAndFlex()`
**File**: `frontend/lib/mujoco-utils.ts` (lines 561-644)

**Purpose**: Update tendon and flex rendering using instanced meshes

**Parameters**:
- `mujocoRoot` - Root group containing cylinder/sphere instances
- `model` - MuJoCo model
- `data` - MuJoCo data
- `swizzle` - Coordinate conversion flag

**What it does**:
1. Iterates over tendons and wrapping points
2. Creates cylinder transforms for each tendon segment
3. Creates sphere transforms for tendon endpoints
4. Updates instance counts on InstancedMesh
5. Marks instance matrices for GPU update

**Note**: Currently only called for original model (not trajectory clones)

---

### Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         User Actions                             │
└──────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
         Select Model    Add Trajectory   Toggle Ghost
                │               │               │
                ▼               ▼               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   React State (visualize/page.tsx)               │
│                                                                  │
│  selectedModelXML: string                                        │
│  loadedTrajectories: LoadedTrajectory[]                          │
│  currentFrame: number                                            │
│  playing: boolean                                                │
└──────────────────────────────────────────────────────────────────┘
                │               │
                │               └─→ Props
                │                   │
                ▼                   ▼
┌──────────────────────────────────────────────────────────────────┐
│              MuJoCoViewer Component (useEffect hooks)            │
│                                                                  │
│  Model Changed → Initialize MuJoCo → Load Scene                 │
│  Trajectories Changed → Create/Remove/Update Bodies              │
│  Frame Changed → Update Transforms → Render                     │
└──────────────────────────────────────────────────────────────────┘
                │               │               │
                ▼               ▼               ▼
         ┌──────────┐   ┌─────────────┐   ┌──────────┐
         │  MuJoCo  │   │ THREE.js    │   │  Canvas  │
         │   WASM   │   │   Scene     │   │ (WebGL)  │
         └──────────┘   └─────────────┘   └──────────┘
                │               │               │
                └───────────────┴───────────────┘
                                │
                                ▼
                        Rendered Output
```

### State Flow for Single Frame Render

```
1. User clicks Play
   │
   ├─→ setPlaying(true)
   │
   └─→ useEffect triggers animation loop
       │
       └─→ requestAnimationFrame callback
           │
           ├─→ Calculate frame delta based on time
           │
           └─→ setCurrentFrame(newFrame)
               │
               └─→ MuJoCoViewer sees currentFrame change
                   │
                   └─→ animate() function runs
                       │
                       ├─→ For each trajectory:
                       │   │
                       │   ├─→ Get qpos at currentFrame
                       │   │
                       │   └─→ applyQposAndUpdateBodies()
                       │       │
                       │       ├─→ Copy qpos to data.qpos
                       │       │
                       │       ├─→ mj_forward(model, data)
                       │       │   └─→ Computes data.xpos, data.xquat
                       │       │
                       │       └─→ Update THREE.js body transforms
                       │           └─→ body.position = data.xpos[b]
                       │               body.quaternion = data.xquat[b]
                       │
                       └─→ renderer.render(scene, camera)
                           │
                           └─→ WebGL draws to canvas
```

---

## Performance Considerations

### Bottlenecks

1. **Forward Kinematics** - `mj_forward()` called once per trajectory per frame
2. **Mesh Cloning** - Creating trajectory bodies clones all geometries
3. **Material Updates** - Ghost toggle traverses entire scene graph
4. **Render Calls** - Single render call per animation frame (good)

### Optimizations

1. **Instanced Meshes** - Tendons use InstancedMesh (efficient for repeated geometry)
2. **Shared Geometry** - Cloned meshes share BufferGeometry (low memory)
3. **Separate Data Instances** - Each trajectory has independent MuJoCo data
4. **Render Order** - Ghost objects render first, then opaque (reduces overdraw)
5. **Conditional Updates** - Only update trajectories that are loaded
6. **Frame Clamping** - Trajectories shorter than maxFrame show last frame (no errors)

### Memory Usage

**Per Model**:
- MuJoCo model: ~500KB - 5MB (depends on complexity)
- MuJoCo data instance: ~1-10MB (state vectors)
- THREE.js geometries: Shared (negligible per-trajectory cost)
- THREE.js materials: Cloned per trajectory (~10KB each)

**Per Trajectory**:
- Qpos data: `frameCount × nq × 8 bytes` (e.g., 1000 frames × 20 joints × 8 = 160KB)
- MuJoCo data instance: ~1-10MB
- Cloned bodies/materials: ~100KB - 1MB

**Typical usage** (2 trajectories, 1000 frames, 20 DOF):
- Total: ~15-30MB (very manageable)

---

## Common Workflows

### Loading a Model and Trajectory

```
1. User selects model from ModelSelector
   → handleModelSelect() called
   → setSelectedModelXML(xml)
   → setSelectedModel(metadata)

2. MuJoCoViewer receives new modelXML
   → useEffect triggers
   → Load MuJoCo WASM
   → Parse XML → model
   → Create data instance
   → loadMuJoCoScene() → create THREE.js objects
   → Add to scene
   → Initialize to default pose (qpos0)

3. User selects trajectory from TrajectorySelector
   → handleTrajectorySelect() called
   → Fetch .npy file from server
   → parseTrajectory() → TrajectoryData
   → Create LoadedTrajectory object
   → setLoadedTrajectories([...prev, newTraj])

4. MuJoCoViewer receives new trajectories array
   → useEffect triggers
   → Clone bodies for new trajectory
   → Create MuJoCo data instance
   → Add to trajectoryBodiesMap
   → Add to scene
   → Hide original bodies (mujocoRoot.visible = false)

5. User clicks Play
   → setPlaying(true)
   → Animation loop starts
   → currentFrame increments each frame
   → applyQposAndUpdateBodies() called for each trajectory
   → Bodies animate
```

### Toggling Ghost Mode

```
1. User clicks ghost checkbox in TrajectoryList
   → onToggleGhost(trajectoryId) called
   → setLoadedTrajectories() updates isGhost flag

2. MuJoCoViewer sees trajectories change
   → useEffect triggers
   → Traverses trajectory root group
   → For each mesh:
       if (traj.isGhost):
         material.transparent = true
         material.opacity = 0.35
         renderOrder = -1
       else:
         material.transparent = false
         material.opacity = 1.0
         renderOrder = 0
   → Next frame renders with new appearance
```

### Recording Video

```
1. User clicks Record button
   → handleRecord() called
   → Create offscreen renderer (1920×1080)
   → Create StreamingRecorder (WebM)
   → Pause playback (setPlaying(false))

2. For each video frame (0 to totalVideoFrames):
   → Calculate trajectory frame index
   → For each trajectory:
       → Get qpos at frame
       → applyQposAndUpdateBodies()
   → Render to offscreen canvas
   → recorder.addFrame(canvas)
   → Update progress bar

3. When complete:
   → recorder.stop()
   → Generate WebM blob
   → Create download link
   → Auto-download file
   → Cleanup offscreen renderer
```

---

## Future Enhancements

### Potential Improvements

1. **Tendon rendering on trajectory clones**
   - Clone cylinder/sphere InstancedMesh per trajectory
   - Apply ghost materials to tendon instances

2. **Interpolation between frames**
   - Use fractional currentFrame (e.g., 42.7)
   - Slerp quaternions between frames
   - Smoother animation at low framerates

3. **Contact force visualization**
   - Read `data.contact` from MuJoCo
   - Render contact points as spheres
   - Show force vectors as arrows

4. **Joint angle display**
   - Overlay qpos values on bodies
   - Show joint limits (green/yellow/red)

5. **Center of mass visualization**
   - Compute from `data.xipos` (inertial positions)
   - Show COM trajectory as trail

6. **Performance profiling**
   - Measure `mj_forward()` time per trajectory
   - Show FPS counter
   - Warn if real-time playback not achievable

---

## Troubleshooting

### Bodies appear at origin
**Symptom**: All bodies at (0, 0, 0) when no trajectory loaded

**Cause**: Bodies not initialized to default pose after scene creation

**Fix**: Already implemented in [MuJoCoViewer.tsx:747-775](../components/MuJoCoViewer.tsx#L747-L775)

### Weird cylinders/spheres appear
**Symptom**: Unexpected tendon geometry visible

**Cause**: Passing `entry.root` to `applyQposAndUpdateBodies()` for trajectory clones

**Fix**: Pass `undefined` instead of `entry.root` (lines 805, 947)

### Original bodies stay visible with trajectories
**Symptom**: qpos0 pose overlaps with trajectory animations

**Cause**: mujocoRoot not hidden when trajectories loaded

**Fix**: Already implemented in [MuJoCoViewer.tsx:290-301](../components/MuJoCoViewer.tsx#L290-L301)

### Trajectories all show same pose
**Symptom**: Multiple trajectories move identically

**Cause**: Sharing same MuJoCo data instance

**Fix**: Each trajectory needs its own `data` instance (already implemented)

### Ghost mode doesn't work
**Symptom**: Clicking ghost checkbox has no effect

**Cause**: Materials not being updated when isGhost changes

**Fix**: useEffect must depend on `trajectories` array and update materials

---

## Summary

The Motion Library's MuJoCo rendering system:

1. **Loads** MuJoCo models from XML and creates THREE.js scene graphs
2. **Renders** using a body-based hierarchy that matches MuJoCo's kinematic tree
3. **Animates** by applying qpos → forward kinematics → body transforms
4. **Supports** multiple trajectories with independent playback and ghost mode
5. **Records** videos by rendering frames offline at desired resolution

Key design decisions:
- **Body-based updates** (not geometry-based) for better organization
- **Separate MuJoCo data instances** per trajectory for independent computation
- **Shared geometries** but cloned materials for memory efficiency
- **Frame-based synchronization** across all trajectories
- **Ghost rendering** via transparency and render order

This architecture balances performance, flexibility, and code maintainability.
