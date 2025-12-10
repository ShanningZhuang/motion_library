# Code Structure Reference

Quick reference for key code locations and their responsibilities.

## Core Files

### [`frontend/components/MuJoCoViewer.tsx`](../frontend/components/MuJoCoViewer.tsx)

**Purpose**: Main 3D viewer component - handles MuJoCo initialization, scene management, and rendering

**Key Sections**:

| Lines | Function | Description |
|-------|----------|-------------|
| 1-117 | Props & Types | Interface definitions for viewer configuration |
| 118-210 | State & Refs | React state and refs for MuJoCo/THREE.js objects |
| 220-314 | Trajectory Management | Creates/removes/updates trajectory bodies when trajectories change |
| 315-615 | Model Loading | Initializes MuJoCo, loads model XML, creates scene |
| 628-780 | Scene Creation | Calls `loadMuJoCoScene()`, sets up cameras/lights/renderer |
| 747-775 | Default Pose Init | Updates bodies to qpos0 after scene creation |
| 782-841 | Camera Setup | Parses MuJoCo cameras, creates THREE.js cameras |
| 842-886 | Animation Loop | `animate()` - updates trajectories and renders each frame |
| 799-811 | Trajectory Rendering | Applies qpos and updates body transforms per trajectory |
| 888-1012 | Video Recording | `recordVideo()` - offline rendering to WebM |

**Key Variables**:
```typescript
mujocoRef.current         // MuJoCo WASM module instance
modelRef.current          // Compiled MuJoCo model
dataRef.current           // MuJoCo data for original model
sceneRef.current          // THREE.Scene
rendererRef.current       // THREE.WebGLRenderer
mujocoRootRef.current     // Root THREE.Group for original model bodies
bodiesRef.current         // Original model bodies (indexed by body ID)

trajectoryBodiesMap.current  // Map<trajectoryId, { bodies, data, root }>
```

---

### [`frontend/lib/mujoco-utils.ts`](../frontend/lib/mujoco-utils.ts)

**Purpose**: Core utilities for MuJoCo scene creation and rendering

**Key Functions**:

| Lines | Function | Description |
|-------|----------|-------------|
| 263-446 | `loadMuJoCoScene()` | Converts MuJoCo model to THREE.js scene graph |
| 267-350 | ↳ Body Parsing | Creates THREE.Group for each body |
| 351-390 | ↳ Geometry Creation | Creates meshes (sphere, box, cylinder, capsule, mesh, plane) |
| 391-431 | ↳ Tendon Instances | Creates InstancedMesh for tendons/flex |
| 434-446 | ↳ Scene Hierarchy | Adds bodies to scene graph |
| 460-500 | `applyQposAndUpdateBodies()` | Updates body transforms from qpos |
| 476-478 | ↳ Copy qpos | Copies joint positions to MuJoCo data |
| 481 | ↳ Forward Kinematics | Calls `mj_forward()` to compute body poses |
| 484-491 | ↳ Update Transforms | Reads `data.xpos`/`data.xquat` → THREE.js bodies |
| 494-499 | ↳ Tendon Rendering | Optionally updates tendons if mujocoRoot provided |
| 511-550 | `createGhostBodies()` | Clones bodies with semi-transparent materials |
| 561-644 | `drawTendonsAndFlex()` | Updates tendon/flex InstancedMesh transforms |

**Helper Functions**:
```typescript
getPosition(data: Float64Array, index: number, out: Vector3, swizzle: boolean)
  // Reads 3D position from MuJoCo data array

getQuaternion(data: Float64Array, index: number, out: Quaternion, swizzle: boolean)
  // Reads quaternion from MuJoCo data array

setupLights(scene: THREE.Scene)
  // Adds ambient, directional, and point lights
```

---

### [`frontend/app/visualize/page.tsx`](../frontend/app/visualize/page.tsx)

**Purpose**: Main visualization page - manages state, trajectory loading, playback controls

**Key Sections**:

| Lines | Section | Description |
|-------|---------|-------------|
| 16-22 | Types | `LoadedTrajectory` interface definition |
| 24-39 | State | Model, trajectories, playback state |
| 42-44 | Computed Values | maxFrameCount, primaryFrameRate |
| 46-89 | Playback Loop | Animation loop - advances currentFrame based on time |
| 91-94 | Model Selection | handleModelSelect() - sets selected model |
| 97-117 | Server Trajectory | handleTrajectorySelect() - loads from server |
| 120-141 | Local Upload | handleLocalTrajectoryUpload() - loads from file |
| 144-150 | Ghost Toggle | handleToggleGhost() - toggles transparency |
| 153-155 | Remove Trajectory | handleRemoveTrajectory() - removes from list |
| 157-164 | Playback Controls | handlePlayPause(), handleReset() |
| 166-258 | Keyboard Shortcuts | Space (play/pause), R (reset), arrows (step) |
| 351-403 | Timeline UI | Slider, frame display, time display |
| 407-454 | Playback Controls UI | Play/pause, reset, step, speed selector |
| 484-494 | Video Controls | Camera selector, record button |
| 497-521 | Trajectory Loading | Model selector, trajectory selector, upload |
| 524-530 | Trajectory List | Shows loaded trajectories with controls |
| 543-556 | MuJoCoViewer | Renders 3D scene |

**State Management**:
```typescript
selectedModelXML: string                  // Model XML content
selectedModel: ModelMetadata | null       // Model metadata
loadedTrajectories: LoadedTrajectory[]    // All loaded trajectories
playing: boolean                          // Is animation playing?
currentFrame: number                      // Current frame (float)
playbackSpeed: number                     // Speed multiplier (0.25x - 2x)
viewerOptions: ViewerOptions              // Axes visibility, etc.
cameras: MuJoCoCamera[]                   // Available cameras
activeCamera: string                      // Active camera ID
isRecording: boolean                      // Is recording video?
recordingProgress: number                 // Recording progress (0-100)
```

---

### [`frontend/components/TrajectoryList.tsx`](../frontend/components/TrajectoryList.tsx)

**Purpose**: Displays loaded trajectories with controls

**Structure** (64 lines total):
```typescript
Lines 1-18:   Imports and type definitions
Lines 19-65:  Component implementation
  Lines 21-24:  Header with count
  Lines 26-28:  Empty state
  Lines 30-62:  Map over trajectories
    Lines 33-39:  Ghost checkbox
    Lines 42-44:  Trajectory name
    Lines 47-51:  Source badge (server/local)
    Lines 54-60:  Remove button
```

**Props**:
```typescript
interface TrajectoryListProps {
  trajectories: LoadedTrajectory[];        // All loaded trajectories
  onToggleGhost: (id: string) => void;     // Toggle ghost mode
  onRemove: (id: string) => void;          // Remove trajectory
}
```

---

### [`frontend/components/TrajectoryUpload.tsx`](../frontend/components/TrajectoryUpload.tsx)

**Purpose**: Local file upload component for .npy/.npz files

**Key Features**:
- Drag-and-drop support
- Click to browse
- File type validation (.npy/.npz only)
- Disabled state when no model loaded

**Event Handlers**:
```typescript
handleFileChange()   // File input onChange
handleDragOver()     // Drag enter
handleDragLeave()    // Drag leave
handleDrop()         // File drop
```

---

### [`frontend/lib/trajectory-parser.ts`](../frontend/lib/trajectory-parser.ts)

**Purpose**: Parse NumPy .npy/.npz files containing trajectory data

**Key Types**:
```typescript
interface TrajectoryData {
  qpos: Float64Array[];     // [frame][joint] - joint positions
  frameCount: number;       // Number of frames
  frameRate: number;        // FPS (default: 30)
  jointCount: number;       // Number of joints (nq)
}
```

**Functions**:
```typescript
parseTrajectory(blob: Blob, filename: string): Promise<TrajectoryData>
  // Main entry point - detects format and parses

parseNpy(arrayBuffer: ArrayBuffer): Float64Array
  // Parses .npy format (single array)

parseNpz(arrayBuffer: ArrayBuffer): Record<string, Float64Array>
  // Parses .npz format (zip of multiple arrays)
```

**Supported Formats**:
1. `.npy` - Single 2D array (frames × joints)
2. `.npz` - Archive with 'qpos' key containing 2D array

---

### [`frontend/lib/streaming-recorder.ts`](../frontend/lib/streaming-recorder.ts)

**Purpose**: Record video using MediaRecorder API (WebM format)

**Key Class**:
```typescript
class StreamingRecorder {
  constructor(canvas: HTMLCanvasElement, options: RecorderOptions)

  async start(): Promise<void>
    // Starts recording

  async addFrame(canvas: HTMLCanvasElement): Promise<void>
    // Adds a frame to the recording

  async stop(): Promise<Blob>
    // Stops recording and returns WebM blob

  getFrameCount(): number
    // Returns number of frames recorded
}
```

**Options**:
```typescript
interface RecorderOptions {
  fps: number;              // Target framerate
  videoBitsPerSecond: number;  // Video quality
}
```

---

## Component Hierarchy

```
visualize/page.tsx
  │
  ├─→ ModelSelector
  │     └─→ Fetches models from backend
  │         └─→ onModelSelect(xml, metadata)
  │
  ├─→ TrajectorySelector
  │     └─→ Fetches trajectories from backend
  │         └─→ onTrajectorySelect(blob, metadata)
  │
  ├─→ TrajectoryUpload
  │     └─→ File picker for .npy/.npz
  │         └─→ onFileSelect(file)
  │
  ├─→ TrajectoryList
  │     ├─→ Maps over loadedTrajectories
  │     ├─→ Checkbox per trajectory (ghost mode)
  │     ├─→ Remove button per trajectory
  │     └─→ Shows source badge (server/local)
  │
  ├─→ ViewerOptionsPanel
  │     └─→ Toggles for axes visibility
  │
  ├─→ VideoControls
  │     ├─→ Camera selector
  │     └─→ Record button
  │
  └─→ MuJoCoViewer (ref)
        ├─→ Initializes MuJoCo WASM
        ├─→ Creates THREE.js scene
        ├─→ Manages trajectory bodies
        ├─→ Runs animation loop
        └─→ Handles video recording
```

---

## Data Flow

### Model Loading Flow
```
User clicks model
  ↓
ModelSelector.onModelSelect(xml, metadata)
  ↓
page.tsx: setSelectedModelXML(xml)
  ↓
MuJoCoViewer receives modelXML prop
  ↓
useEffect: modelXML changed
  ↓
Load MuJoCo WASM
  ↓
mujoco.Model.load_from_xml(modelXML)
  ↓
new mujoco.Data(model)
  ↓
loadMuJoCoScene(mujoco, model, meshDir)
  ↓
Create THREE.js bodies, meshes, materials
  ↓
Add to scene
  ↓
Initialize to qpos0 (default pose)
```

### Trajectory Loading Flow
```
User selects trajectory OR uploads file
  ↓
page.tsx: handleTrajectorySelect() or handleLocalTrajectoryUpload()
  ↓
parseTrajectory(blob, filename)
  ↓
Create LoadedTrajectory object
  ↓
setLoadedTrajectories([...prev, newTraj])
  ↓
MuJoCoViewer receives trajectories prop
  ↓
useEffect: trajectories changed
  ↓
For each new trajectory:
  ├─→ Clone bodies (ghost or normal)
  ├─→ Create MuJoCo data instance
  ├─→ Create THREE.Group root
  ├─→ Add to scene
  └─→ Store in trajectoryBodiesMap
  ↓
Hide original bodies (mujocoRoot.visible = false)
```

### Animation Loop Flow
```
User clicks Play
  ↓
page.tsx: setPlaying(true)
  ↓
useEffect: playing changed
  ↓
requestAnimationFrame loop starts
  ↓
Calculate frame delta (time × fps × speed)
  ↓
setCurrentFrame(prev + delta)
  ↓
MuJoCoViewer.animate() runs
  ↓
For each trajectory:
  ├─→ Get qpos at currentFrame
  ├─→ applyQposAndUpdateBodies()
  │     ├─→ Copy qpos to data.qpos
  │     ├─→ mj_forward(model, data)
  │     └─→ Update body.position/quaternion from data.xpos/xquat
  └─→ body.updateWorldMatrix()
  ↓
renderer.render(scene, camera)
  ↓
WebGL draws to canvas
```

---

## Key Algorithms

### Forward Kinematics Update

**Location**: `frontend/lib/mujoco-utils.ts` (lines 460-500)

```
Input: qpos (joint positions)
  ↓
Step 1: Copy to MuJoCo data
  for i in 0..nq:
    data.qpos[i] = qpos[i]
  ↓
Step 2: Compute forward kinematics
  mujoco.mj_forward(model, data)
  ↓
  MuJoCo computes:
    - data.xpos (body positions)
    - data.xquat (body orientations)
    - data.geom_xpos (geometry positions)
    - data.geom_xmat (geometry orientations)
  ↓
Step 3: Update THREE.js bodies
  for b in 0..nbody:
    body[b].position = data.xpos[b*3 : b*3+3]
    body[b].quaternion = data.xquat[b*4 : b*4+4]
    body[b].updateWorldMatrix()
  ↓
Output: Updated body transforms in scene
```

### Ghost Body Creation

**Location**: `frontend/lib/mujoco-utils.ts` (lines 511-550)

```
Input: sourceBodies (original bodies)
  ↓
For each body:
  ├─→ Deep clone body group
  │     └─→ body.clone(true)
  │
  ├─→ Traverse all children
  │     └─→ For each mesh:
  │           ├─→ Clone material
  │           ├─→ Set color = ghostColor (0x4488ff)
  │           ├─→ Set transparent = true
  │           ├─→ Set opacity = 0.35
  │           ├─→ Set depthWrite = false
  │           └─→ Set renderOrder = -1
  │
  └─→ Rename to "original_name_ghost"
  ↓
Output: Array of ghost bodies
```

### Multi-Trajectory Synchronization

**Location**: `frontend/components/MuJoCoViewer.tsx` (lines 799-811)

```
Input: currentFrame (float), trajectories[]
  ↓
For each trajectory:
  ├─→ Get trajectory entry from map
  │     entry = trajectoryBodiesMap.get(traj.id)
  │
  ├─→ Clamp frame to trajectory length
  │     frameIndex = min(currentFrame, traj.frameCount - 1)
  │
  ├─→ Get qpos at frame
  │     qposData = traj.data.qpos[frameIndex]
  │
  └─→ Update bodies
        applyQposAndUpdateBodies(
          qposData,
          mujoco,
          model,
          entry.data,      // Trajectory-specific data instance
          entry.bodies,    // Trajectory-specific bodies
          undefined,       // Don't render tendons
          false
        )
  ↓
All trajectories updated to same time point
```

---

## Memory Layout

### MuJoCo Data Arrays

```
data.qpos       [nq]          Joint positions
data.qvel       [nv]          Joint velocities
data.qacc       [nv]          Joint accelerations
data.xpos       [nbody × 3]   Body positions (world space)
data.xquat      [nbody × 4]   Body quaternions (world space)
data.xmat       [nbody × 9]   Body rotation matrices (world space)
data.geom_xpos  [ngeom × 3]   Geometry positions (world space)
data.geom_xmat  [ngeom × 9]   Geometry rotation matrices (world space)
```

**Access Pattern**:
```typescript
// Body b position
const x = data.xpos[b * 3 + 0];
const y = data.xpos[b * 3 + 1];
const z = data.xpos[b * 3 + 2];

// Body b quaternion (w, x, y, z in MuJoCo)
const w = data.xquat[b * 4 + 0];
const x = data.xquat[b * 4 + 1];
const y = data.xquat[b * 4 + 2];
const z = data.xquat[b * 4 + 3];

// THREE.js expects (x, y, z, w)
quaternion.set(x, y, z, w);
```

### Trajectory Data Structure

```typescript
LoadedTrajectory {
  id: "server-123-1234567890"      // Unique ID
  name: "walk_forward.npy"         // Display name
  source: "server"                 // "server" | "local"
  isGhost: false                   // Ghost mode flag
  data: TrajectoryData {
    qpos: [                        // Frame-by-frame qpos
      Float64Array[nq],            // Frame 0
      Float64Array[nq],            // Frame 1
      ...
      Float64Array[nq]             // Frame N-1
    ]
    frameCount: 1000               // Number of frames
    frameRate: 30                  // FPS
    jointCount: 20                 // nq
  }
}
```

### Scene Graph Memory

```
Scene
  └─→ mujocoRoot (visible = false when trajectories loaded)
        ├─→ bodies[0..nbody-1]
        │     └─→ meshes (shared BufferGeometry)
        ├─→ cylinders (InstancedMesh)
        └─→ spheres (InstancedMesh)

  └─→ Trajectory_1
        └─→ cloned bodies[0..nbody-1]
              └─→ cloned meshes (shared BufferGeometry, cloned materials)

  └─→ Trajectory_2
        └─→ cloned bodies[0..nbody-1]
              └─→ cloned meshes (shared BufferGeometry, cloned materials)
```

**Memory Efficiency**:
- ✅ BufferGeometry shared (vertex data only stored once)
- ✅ Materials cloned (small overhead ~10KB per trajectory)
- ✅ MuJoCo data cloned (necessary for independent FK computation)

---

## Function Call Graph

### Initialization

```
MuJoCoViewer.tsx:useEffect (modelXML change)
  ├─→ load_mujoco()
  ├─→ mujoco.Model.load_from_xml(modelXML)
  ├─→ new mujoco.Data(model)
  └─→ loadMuJoCoScene(mujoco, model)
        ├─→ createSceneObjectsFromMuJoCo()
        │     ├─→ Create bodies (THREE.Group)
        │     ├─→ Create geometries (Sphere, Box, Cylinder, etc.)
        │     ├─→ Create materials (MeshPhongMaterial)
        │     └─→ Apply local transforms
        ├─→ Create InstancedMesh for tendons
        ├─→ Build scene hierarchy
        ├─→ mj_forward(model, data)
        └─→ Initialize body transforms to qpos0
```

### Trajectory Loading

```
page.tsx:handleTrajectorySelect()
  ├─→ parseTrajectory(blob, filename)
  │     ├─→ Detect format (.npy vs .npz)
  │     ├─→ parseNpy() or parseNpz()
  │     └─→ Return TrajectoryData
  ├─→ Create LoadedTrajectory object
  └─→ setLoadedTrajectories([...prev, newTraj])
        ↓
MuJoCoViewer.tsx:useEffect (trajectories change)
  ├─→ For each new trajectory:
  │     ├─→ createGhostBodies() or clone()
  │     ├─→ new mujoco.Data(model)
  │     ├─→ Create THREE.Group root
  │     └─→ trajectoryBodiesMap.set()
  └─→ mujocoRoot.visible = false
```

### Frame Update

```
page.tsx:useEffect (playing)
  └─→ requestAnimationFrame loop
        └─→ setCurrentFrame(prev + delta)
              ↓
MuJoCoViewer.tsx:animate()
  ├─→ For each trajectory:
  │     └─→ applyQposAndUpdateBodies()
  │           ├─→ Copy qpos to data
  │           ├─→ mj_forward(model, data)
  │           └─→ Update body transforms
  │                 ├─→ getPosition()
  │                 ├─→ getQuaternion()
  │                 └─→ body.updateWorldMatrix()
  └─→ renderer.render(scene, camera)
```

---

## Important Constants

**Location**: Various files

```typescript
// Coordinate system
const SWIZZLE = false;  // Use MuJoCo's Z-up coordinate system directly

// Ghost appearance
const GHOST_COLOR = 0x4488ff;     // Light blue
const GHOST_OPACITY = 0.35;       // 35% opaque
const GHOST_RENDER_ORDER = -1;    // Render before opaque objects

// Default framerate
const DEFAULT_FPS = 30;

// Video recording
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const VIDEO_BITRATE = 5_000_000;  // 5 Mbps

// Playback speeds
const SPEED_OPTIONS = [0.25, 0.5, 1.0, 1.5, 2.0];

// Tendon material
const TENDON_COLOR = new THREE.Color(0.95, 0.3, 0.3);  // Red
const TENDON_SHININESS = 30;
const TENDON_SPECULAR = new THREE.Color(0.3, 0.3, 0.3);
```

---

## Testing Checklist

When modifying the rendering system, verify:

- [ ] Model loads and appears in default pose (qpos0)
- [ ] Original bodies hidden when trajectory loaded
- [ ] Multiple trajectories can be loaded
- [ ] Trajectories animate independently
- [ ] Ghost mode toggles correctly
- [ ] Trajectories can be removed
- [ ] Playback controls work (play/pause/reset/step)
- [ ] Timeline slider updates correctly
- [ ] Speed control works (0.25x - 2x)
- [ ] Keyboard shortcuts work (Space, R, arrows)
- [ ] Video recording captures all trajectories
- [ ] Camera switching works
- [ ] No memory leaks when adding/removing trajectories
- [ ] No console errors
- [ ] Performance acceptable with 5+ trajectories

---

## Quick Reference: Where to Look

**Need to add a new geometry type?**
→ `frontend/lib/mujoco-utils.ts` lines 351-390

**Need to change ghost appearance?**
→ `frontend/lib/mujoco-utils.ts` lines 511-550

**Need to modify playback logic?**
→ `frontend/app/visualize/page.tsx` lines 46-89

**Need to add a new trajectory source?**
→ `frontend/app/visualize/page.tsx` - add new handler like `handleTrajectorySelect()`

**Need to change rendering pipeline?**
→ `frontend/components/MuJoCoViewer.tsx` lines 842-886

**Need to modify video recording?**
→ `frontend/components/MuJoCoViewer.tsx` lines 888-1012

**Need to parse a new trajectory format?**
→ `frontend/lib/trajectory-parser.ts`

**Need to add new MuJoCo features (contacts, forces, etc.)?**
→ `frontend/lib/mujoco-utils.ts` - add new utility functions
