'use client';

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  loadMuJoCo,
  loadModelFromXML,
  loadModelWithDependencies,
  cleanupModel,
  getDefaultSceneXML,
  MuJoCoModule,
} from '@/lib/mujoco-loader';
import { modelApi, ModelMetadata } from '@/lib/api';
import { loadMuJoCoScene, applyQposAndUpdateBodies, createGhostBodies } from '@/lib/mujoco-utils';
import { MuJoCoCamera } from './VideoControls';
import {
  createRecordingRenderer,
  createRecordingCamera,
  downloadBlob
} from '@/lib/video-recorder';
import { StreamingRecorder } from '@/lib/streaming-recorder';

export interface ViewerOptions {
  showFixedAxes: boolean;
  showMovingAxes: boolean;
}

export interface TrajectoryPlaybackState {
  qpos: Float64Array[];  // Array of qpos arrays, one per frame
  currentFrame: number;
  isPlaying: boolean;
  playbackSpeed: number;
  frameRate: number;
}

interface LoadedTrajectory {
  id: string;
  name: string;
  data: {
    qpos: Float64Array[];
    frameCount: number;
    frameRate: number;
  };
  isGhost: boolean;
  source: 'server' | 'local';
}

interface MuJoCoViewerProps {
  modelXML?: string;
  modelId?: string;
  modelMetadata?: ModelMetadata;
  options?: ViewerOptions;
  trajectories: LoadedTrajectory[];
  currentFrame: number;
  onModelLoaded?: () => void;
  onError?: (error: string) => void;
  onCamerasLoaded?: (cameras: MuJoCoCamera[]) => void;
  activeCamera?: string;
}

export interface MuJoCoViewerRef {
  recordVideo: (onProgress?: (progress: number) => void) => Promise<void>;
}

const MuJoCoViewer = forwardRef<MuJoCoViewerRef, MuJoCoViewerProps>(function MuJoCoViewer(
  { modelXML, modelId, modelMetadata, options, trajectories, currentFrame, onModelLoaded, onError, onCamerasLoaded, activeCamera },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const mujocoRef = useRef<MuJoCoModule | null>(null);
  const modelRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const bodiesRef = useRef<{ [key: number]: THREE.Group }>({});
  const meshesRef = useRef<{ [key: number]: THREE.BufferGeometry }>({});
  const mujocoRootRef = useRef<THREE.Group | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  // Map to store trajectory bodies, data, and root for each loaded trajectory
  const trajectoryBodiesMap = useRef<Map<string, {
    bodies: (THREE.Group | null)[];
    data: any;
    root: THREE.Group;
  }>>(new Map());

  // Track trajectories and current frame in refs so animation loop can access latest values
  const trajectoriesRef = useRef<LoadedTrajectory[]>(trajectories);
  const currentFrameRef = useRef<number>(currentFrame);

  // Axis helper scene and camera for corner inset
  const axisSceneRef = useRef<THREE.Scene | null>(null);
  const axisCameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Camera management
  const [cameras, setCameras] = useState<MuJoCoCamera[]>([]);
  const camerasRef = useRef<MuJoCoCamera[]>([]);
  const activeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const activeCameraIdRef = useRef<number>(-1); // -1 for free, >= 0 for MuJoCo camera ID

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Update trajectory refs whenever props change
  useEffect(() => {
    trajectoriesRef.current = trajectories;
    currentFrameRef.current = currentFrame;
  }, [trajectories, currentFrame]);

  // Load cameras when model changes
  useEffect(() => {
    if (modelRef.current && cameraRef.current) {
      const loadedCameras = loadCamerasFromModel(modelRef.current, cameraRef.current);
      setCameras(loadedCameras);
      camerasRef.current = loadedCameras; // Store in ref for render loop
      activeCameraRef.current = cameraRef.current; // Start with free camera
      activeCameraIdRef.current = -1; // Free camera

      if (onCamerasLoaded) {
        onCamerasLoaded(loadedCameras);
      }
    }
  }, [modelRef.current, onCamerasLoaded]);

  // Handle camera switching
  useEffect(() => {
    console.log('[CAMERAS] Camera switch effect triggered', { activeCamera, camerasLength: cameras.length });

    if (!activeCamera || cameras.length === 0) {
      console.log('[CAMERAS] Skipping - no activeCamera or cameras empty');
      return;
    }

    const selectedCamera = cameras.find(cam => cam.name === activeCamera);
    if (!selectedCamera) {
      console.warn(`[CAMERAS] Camera "${activeCamera}" not found in cameras list`);
      return;
    }

    console.log(`[CAMERAS] Switching to camera: ${activeCamera} (mujocoId: ${selectedCamera.mujocoId})`);

    // Store camera ID in ref for render loop access
    activeCameraIdRef.current = selectedCamera.mujocoId;

    // For free camera, use the main camera and enable controls
    if (selectedCamera.mujocoId === -1) {
      activeCameraRef.current = cameraRef.current;
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
        console.log('[CAMERAS] Free camera activated, OrbitControls enabled');
      }
    } else {
      // For MuJoCo cameras, we'll use the main camera but update its transform from MuJoCo data
      // Disable orbit controls for MuJoCo cameras
      activeCameraRef.current = cameraRef.current;
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
        console.log('[CAMERAS] MuJoCo camera activated, OrbitControls disabled');
      }

      // Log camera properties
      if (modelRef.current) {
        const fovy = modelRef.current.cam_fovy?.[selectedCamera.mujocoId];
        const orthographic = modelRef.current.cam_orthographic?.[selectedCamera.mujocoId];
        console.log(`[CAMERAS] Camera properties - fovy: ${fovy}, orthographic: ${orthographic}`);
      }
    }
  }, [activeCamera, cameras]);

  // Debug helper - expose scene to window for debugging
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).debugMuJoCo = {
        scene: sceneRef.current,
        camera: cameraRef.current,
        renderer: rendererRef.current,
        model: modelRef.current,
        data: dataRef.current,
        bodies: bodiesRef.current,
        logSceneGraph: () => {
          if (!sceneRef.current) {
            console.log('Scene not initialized');
            return;
          }
          console.log('=== Three.js Scene Graph ===');
          sceneRef.current.traverse((object) => {
            const indent = '  '.repeat(getObjectDepth(object, sceneRef.current!));
            console.log(`${indent}${object.type}: ${object.name || '(unnamed)'}`);
            if (object instanceof THREE.Mesh) {
              console.log(`${indent}  ├─ Geometry: ${object.geometry.type}`);
              console.log(`${indent}  └─ Material: ${(object.material as any).type}`);
            }
          });
          console.log('=== Total Objects ===');
          let meshCount = 0;
          sceneRef.current.traverse((obj) => {
            if (obj instanceof THREE.Mesh) meshCount++;
          });
          console.log(`Meshes: ${meshCount}`);
          console.log(`Total children: ${sceneRef.current.children.length}`);
        },
        getMuJoCoRoot: () => {
          return sceneRef.current?.getObjectByName('MuJoCo Root');
        },
      };
      console.log('Debug tools available: window.debugMuJoCo');
      console.log('  - debugMuJoCo.logSceneGraph() - Print scene structure');
      console.log('  - debugMuJoCo.scene - Access Three.js scene');
      console.log('  - debugMuJoCo.camera - Access camera');
      console.log('  - debugMuJoCo.model - Access MuJoCo model');
      console.log('  - debugMuJoCo.getMuJoCoRoot() - Get MuJoCo root object');
    }
  }, [sceneRef.current, cameraRef.current, rendererRef.current]);

  // Initialize trajectory bodies when model loads or trajectories change
  useEffect(() => {
    if (!modelRef.current || !mujocoRef.current || !sceneRef.current) {
      return;
    }

    // Check if bodies are loaded
    const bodiesArray = Object.values(bodiesRef.current);
    if (bodiesArray.length === 0) {
      return;
    }

    console.log('[TRAJECTORIES] Syncing trajectory bodies with loaded trajectories');

    // Get list of trajectory IDs we need
    const neededIds = new Set(trajectories.map(t => t.id));

    // Remove trajectories that are no longer loaded
    trajectoryBodiesMap.current.forEach((entry, id) => {
      if (!neededIds.has(id)) {
        sceneRef.current?.remove(entry.root);
        if (entry.data && entry.data.delete) {
          entry.data.delete();
        }
        trajectoryBodiesMap.current.delete(id);
        console.log(`[TRAJECTORIES] Removed trajectory: ${id}`);
      }
    });

    // Add or update existing trajectories
    trajectories.forEach(traj => {
      const existing = trajectoryBodiesMap.current.get(traj.id);

      if (!existing) {
        // Create new trajectory bodies
        const bodies: (THREE.Group | null)[] = traj.isGhost
          ? createGhostBodies(bodiesArray as (THREE.Group | null)[])
          : bodiesArray.map(b => b?.clone(true) ?? null);

        // Create MuJoCo data instance
        const data = new mujocoRef.current!.MjData(modelRef.current);

        // Create root group
        const root = new THREE.Group();
        root.name = `Trajectory_${traj.id}`;
        bodies.forEach(body => body && root.add(body));
        sceneRef.current!.add(root);

        trajectoryBodiesMap.current.set(traj.id, { bodies, data, root });
        console.log(`[TRAJECTORIES] Added trajectory: ${traj.name} (ghost: ${traj.isGhost})`);
        console.log(`[TENDON DEBUG] Trajectory ${traj.id} root created: ${root.name}, has cylinders: ${!!(root as any).cylinders}, has spheres: ${!!(root as any).spheres}`);
      } else {
        // Update ghost appearance if isGhost changed
        existing.root.traverse(obj => {
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

    // Hide/show original bodies based on whether trajectories are loaded
    if (mujocoRootRef.current) {
      if (trajectories.length > 0) {
        // Hide original bodies when trajectories are loaded
        mujocoRootRef.current.visible = false;
        console.log('[TRAJECTORIES] Hiding original bodies (trajectories loaded)');
      } else {
        // Show original bodies when no trajectories are loaded
        mujocoRootRef.current.visible = true;
        console.log('[TRAJECTORIES] Showing original bodies (no trajectories)');
      }
    }

    return () => {
      // Cleanup all trajectory bodies
      trajectoryBodiesMap.current.forEach((entry) => {
        sceneRef.current?.remove(entry.root);
        if (entry.data && entry.data.delete) {
          entry.data.delete();
        }
      });
      trajectoryBodiesMap.current.clear();
      console.log('[TRAJECTORIES] Cleaned up all trajectory bodies');
    };
  }, [trajectories, modelRef.current, mujocoRef.current, sceneRef.current, Object.keys(bodiesRef.current).length]);

  // Helper to calculate object depth in scene graph
  const getObjectDepth = (object: THREE.Object3D, root: THREE.Object3D): number => {
    let depth = 0;
    let current = object;
    while (current.parent && current !== root) {
      depth++;
      current = current.parent;
    }
    return depth;
  };

  // Load cameras from MuJoCo model
  const loadCamerasFromModel = (model: any, freeCamera: THREE.PerspectiveCamera): MuJoCoCamera[] => {
    const loadedCameras: MuJoCoCamera[] = [
      { name: 'free', mujocoId: -1 }
    ];

    if (!model || model.ncam === 0) {
      console.log('[CAMERAS] No MuJoCo cameras found in model');
      return loadedCameras;
    }

    console.log(`[CAMERAS] Loading ${model.ncam} cameras from MuJoCo model`);

    for (let i = 0; i < model.ncam; i++) {
      // Get camera name from MuJoCo model
      const nameAddr = model.name_camadr[i];
      let camName = 'Camera ' + (i + 1);

      if (nameAddr >= 0 && model.names) {
        // Extract null-terminated string from names buffer
        const names = new Uint8Array(model.names);
        let endIdx = nameAddr;
        while (endIdx < names.length && names[endIdx] !== 0) {
          endIdx++;
        }
        const nameBytes = names.slice(nameAddr, endIdx);
        const decodedName = new TextDecoder().decode(nameBytes);
        if (decodedName) {
          camName = decodedName;
        }
      }

      console.log(`[CAMERAS] Camera ${i}: ${camName}`);
      loadedCameras.push({
        name: camName,
        mujocoId: i
      });
    }

    return loadedCameras;
  };

  // Update camera transform from MuJoCo data
  const updateCameraFromMuJoCo = (camera: THREE.PerspectiveCamera, data: any, model: any, camId: number) => {
    if (!data || !model || camId < 0 || camId >= model.ncam) {
      console.warn('[CAMERA UPDATE] Invalid camera update call', { hasData: !!data, hasModel: !!model, camId, ncam: model?.ncam });
      return;
    }

    // Update camera FOV from model
    const fovy = model.cam_fovy[camId]; // cam_fovy is in DEGREES for perspective cameras, or vertical extent for orthographic
    const orthographic = model.cam_orthographic[camId];

    // For perspective cameras, fovy is already in degrees
    if (!orthographic) {
      const oldFov = camera.fov;
      camera.fov = fovy; // Already in degrees, use directly
      camera.updateProjectionMatrix();
      if (Math.abs(oldFov - camera.fov) > 0.1) {
        console.log(`[CAMERA UPDATE] FOV changed from ${oldFov.toFixed(1)}° to ${camera.fov.toFixed(1)}°`);
      }
    }

    // Get camera position from cam_xpos (3 floats per camera)
    const posIdx = camId * 3;
    const mjX = data.cam_xpos[posIdx + 0];
    const mjY = data.cam_xpos[posIdx + 1];
    const mjZ = data.cam_xpos[posIdx + 2];

    console.log(`[CAMERA UPDATE] MuJoCo cam_xpos[${camId}]: [${mjX.toFixed(3)}, ${mjY.toFixed(3)}, ${mjZ.toFixed(3)}]`);

    // Get camera orientation from cam_xmat (9 floats per camera - 3x3 rotation matrix in row-major order)
    // cam_xmat represents the rotation matrix from world frame to camera frame
    const matIdx = camId * 9;

    // Coordinate system alignment:
    // - Both MuJoCo and THREE.js use Z-up coordinate system
    // - Both systems have cameras looking down the -Z axis (forward direction)
    // - Both use +X as right and +Y as up (for a camera looking down -Z)
    //
    // MuJoCo cam_xmat format (row-major, 3x3 rotation matrix):
    // cam_xmat = [right_x, right_y, right_z,      (row 0: camera's right/X axis in world coords)
    //             up_x, up_y, up_z,                (row 1: camera's up/Y axis in world coords)
    //             -forward_x, -forward_y, -forward_z]  (row 2: camera's -Z axis in world coords)

    // Build rotation matrix from MuJoCo camera orientation
    const mat = new THREE.Matrix4();

    // Extract rotation matrix from cam_xmat (row-major)
    const m00 = data.cam_xmat[matIdx + 0]; // right.x
    const m01 = data.cam_xmat[matIdx + 1]; // right.y
    const m02 = data.cam_xmat[matIdx + 2]; // right.z
    const m10 = data.cam_xmat[matIdx + 3]; // up.x
    const m11 = data.cam_xmat[matIdx + 4]; // up.y
    const m12 = data.cam_xmat[matIdx + 5]; // up.z
    const m20 = data.cam_xmat[matIdx + 6]; // -forward.x
    const m21 = data.cam_xmat[matIdx + 7]; // -forward.y
    const m22 = data.cam_xmat[matIdx + 8]; // -forward.z

    // THREE.js Matrix4 format (column-major, 4x4 matrix):
    // Since coordinate systems are aligned, we can directly map MuJoCo's rotation matrix
    // to THREE.js camera matrix by converting from row-major to column-major order
    mat.set(
      m00, m01, m02, mjX,  // Column 0: right vector + X position
      m10, m11, m12, mjY,  // Column 1: up vector + Y position
      m20, m21, m22, mjZ,  // Column 2: -forward vector + Z position
      0, 0, 0, 1           // Column 3: homogeneous coordinates
    );

    // Extract position and rotation
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mat.decompose(position, quaternion, scale);

    const oldPos = camera.position.clone();
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    camera.updateMatrixWorld();

    console.log(`[CAMERA UPDATE] Camera position set: [${position.x.toFixed(3)}, ${position.y.toFixed(3)}, ${position.z.toFixed(3)}]`);
    console.log(`[CAMERA UPDATE] Position change: [${(position.x - oldPos.x).toFixed(3)}, ${(position.y - oldPos.y).toFixed(3)}, ${(position.z - oldPos.z).toFixed(3)}]`);
  };

  // Initialize Three.js scene and MuJoCo WASM
  useEffect(() => {
    if (!containerRef.current) return;

    // If already initialized, don't re-initialize (handles React Strict Mode double mount)
    if (isInitializedRef.current) {
      // But ensure the existing canvas is still in the DOM
      if (rendererRef.current && !containerRef.current.contains(rendererRef.current.domElement)) {
        containerRef.current.appendChild(rendererRef.current.domElement);
      }
      return;
    }

    const initViewer = async () => {
      try {
        isInitializedRef.current = true;
        setLoading(true);
        setError(null);

        // Load MuJoCo WASM
        const mujoco = await loadMuJoCo();
        mujocoRef.current = mujoco;

        // Set up Three.js scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x243447);
        scene.fog = new THREE.Fog(0x243447, 15, 25);
        sceneRef.current = scene;

        // Get container dimensions
        const width = containerRef.current!.clientWidth || window.innerWidth;
        const height = containerRef.current!.clientHeight || window.innerHeight;

        // Set up camera (MuJoCo uses Z-up, so configure camera accordingly)
        const camera = new THREE.PerspectiveCamera(
          45,
          width / height,
          0.001,
          100
        );
        camera.position.set(2.0, 1.7, 1.7);
        camera.up.set(0, 0, 1); // Set Z as up vector to match MuJoCo
        scene.add(camera);
        cameraRef.current = camera;

        // Very bright sunlight-like illumination using ambient + hemisphere
        // No directional light - will use lights from MuJoCo XML environment if needed

        // Very bright ambient light for overall scene illumination
        const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
        scene.add(ambientLight);

        // Strong hemisphere light for natural sky/ground lighting
        const hemisphereLight = new THREE.HemisphereLight(
          0xffffff, // Sky color (bright white)
          0x888888, // Ground color (brighter gray for more fill)
          1.5
        );
        scene.add(hemisphereLight);

        // Set up renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height);

        // Use linear color space to match MuJoCo colors exactly
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        containerRef.current!.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Set up orbit controls (adjust target for Z-up)
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0, 0.7); // Z is up, so use Z for height
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true;
        controls.update();
        controlsRef.current = controls;

        // Add fixed world frame axes at origin (will be toggled via options)
        const worldAxes = new THREE.AxesHelper(0.5);
        worldAxes.name = 'World Frame';
        worldAxes.visible = options?.showFixedAxes ?? true;
        scene.add(worldAxes);

        // Set up axis helper scene for corner display
        const axisScene = new THREE.Scene();
        axisSceneRef.current = axisScene;

        // Create axis camera (fixed position looking at origin)
        const axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
        axisCamera.position.set(0, 0, 2);
        axisCamera.lookAt(0, 0, 0);
        axisCameraRef.current = axisCamera;

        // Create a group to hold the axes (this will rotate with the main camera)
        const axesGroup = new THREE.Group();
        axesGroup.name = 'AxesGroup';
        axisScene.add(axesGroup);

        // Create axes helper (X=red, Y=green, Z=blue)
        const axesHelper = new THREE.AxesHelper(1);
        axesGroup.add(axesHelper);

        // Add labels for axes
        const createAxisLabel = (text: string, position: THREE.Vector3, color: number) => {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          canvas.width = 64;
          canvas.height = 64;
          context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
          context.font = 'Bold 48px Arial';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(text, 32, 32);

          const texture = new THREE.CanvasTexture(canvas);
          const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.position.copy(position);
          sprite.scale.set(0.3, 0.3, 1);
          return sprite;
        };

        axesGroup.add(createAxisLabel('X', new THREE.Vector3(1.3, 0, 0), 0xff0000));
        axesGroup.add(createAxisLabel('Y', new THREE.Vector3(0, 1.3, 0), 0x00ff00));
        axesGroup.add(createAxisLabel('Z', new THREE.Vector3(0, 0, 1.3), 0x0000ff));

        // Load default model from backend
        try {
          // Get the list of models to find the default model
          const modelsData = await modelApi.list();

          // Find the default model (it should be in default/default.xml)
          const defaultModel = modelsData.models.find(
            (m) => m.relative_path === 'default/default.xml'
          );

          if (defaultModel) {
            // Fetch the actual model XML
            const modelBlob = await modelApi.get(defaultModel.id);
            const defaultXML = await modelBlob.text();

            // Use new loading system that handles dependencies
            const { model, data } = await loadModelWithDependencies(
              mujoco,
              defaultModel.id,
              defaultXML,
              defaultModel.relative_path
            );
            modelRef.current = model;
            dataRef.current = data;
            createSceneObjects(scene, mujoco, model, data);

            console.log('Default model loaded successfully');
            console.log('Use debugMuJoCo.logSceneGraph() to inspect scene');

            // Start render loop
            startRenderLoop();
            setLoading(false);
            return;
          }

          throw new Error('Default model not found');
        } catch (err) {
          console.warn('Failed to load default model from backend, using fallback:', err);
          // Fallback to hardcoded default if fetch fails
          const defaultXML = getDefaultSceneXML();
          const { model, data } = loadModelFromXML(mujoco, defaultXML);
          modelRef.current = model;
          dataRef.current = data;
          createSceneObjects(scene, mujoco, model, data);
        }

        // Start render loop
        startRenderLoop();

        setLoading(false);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to initialize viewer';
        setError(errorMsg);
        onError?.(errorMsg);
        setLoading(false);
      }
    };

    initViewer();

    // Cleanup
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      if (rendererRef.current) {
        if (containerRef.current && rendererRef.current.domElement.parentNode === containerRef.current) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
      }
      if (modelRef.current && dataRef.current) {
        cleanupModel(modelRef.current, dataRef.current);
      }
      // Don't reset isInitializedRef - keep it true to prevent re-initialization on Strict Mode remount
    };
  }, []);

  // Handle viewer options changes
  useEffect(() => {
    if (!sceneRef.current) return;

    // Toggle fixed world axes
    const worldAxes = sceneRef.current.getObjectByName('World Frame');
    if (worldAxes) {
      worldAxes.visible = options?.showFixedAxes ?? true;
    }
  }, [options?.showFixedAxes, options?.showMovingAxes]);

  // Handle model loading when modelXML changes
  useEffect(() => {
    if (!modelXML || !mujocoRef.current || !sceneRef.current) return;

    const loadNewModel = async () => {
      try {
        setLoading(true);
        setError(null);

        // Clean up old model
        if (modelRef.current && dataRef.current) {
          cleanupModel(modelRef.current, dataRef.current);
        }

        // Clear scene objects
        console.log('Clearing previous scene objects...');
        clearSceneObjects();

        // Load new model with dependencies if we have model metadata
        let model, data;
        if (modelId && modelMetadata) {
          console.log('Loading model with dependencies:', modelMetadata.relative_path);
          ({ model, data } = await loadModelWithDependencies(
            mujocoRef.current!,
            modelId,
            modelXML,
            modelMetadata.relative_path
          ));
        } else {
          // Fallback to simple loading for backward compatibility
          console.log('Loading model without dependencies (simple mode)');
          ({ model, data } = loadModelFromXML(mujocoRef.current!, modelXML));
        }

        modelRef.current = model;
        dataRef.current = data;

        // Create scene objects for new model
        createSceneObjects(sceneRef.current!, mujocoRef.current!, model, data);

        console.log('New model loaded successfully');
        console.log('Use debugMuJoCo.logSceneGraph() to inspect scene');

        setLoading(false);
        onModelLoaded?.();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load model';
        setError(errorMsg);
        onError?.(errorMsg);
        setLoading(false);
      }
    };

    loadNewModel();
  }, [modelXML, modelId, modelMetadata]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const createSceneObjects = (scene: THREE.Scene, mujoco: any, model: any, data: any) => {
    // Use the utility function from mujoco-utils.ts
    // swizzle=true for Z-up coordinate system (MuJoCo convention)
    const { mujocoRoot, bodies, meshes } = loadMuJoCoScene(mujoco, model, data, scene, false);

    mujocoRootRef.current = mujocoRoot;
    bodiesRef.current = bodies;
    meshesRef.current = meshes;
    console.log(`[TENDON DEBUG] Main scene loaded, mujocoRoot: ${mujocoRoot.name}, has cylinders: ${!!(mujocoRoot as any).cylinders}, has spheres: ${!!(mujocoRoot as any).spheres}`);

    // Forward simulation once to get initial state
    mujoco.mj_forward(model, data);

    // Update body transforms to default pose (qpos0)
    // This ensures bodies appear in correct position when no trajectory is loaded
    for (let b = 0; b < model.nbody; b++) {
      if (bodies[b]) {
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();

        // Get position from MuJoCo data (already at qpos0 after mj_forward)
        pos.set(
          data.xpos[b * 3 + 0],
          data.xpos[b * 3 + 1],
          data.xpos[b * 3 + 2]
        );

        // Get quaternion from MuJoCo data
        quat.set(
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

    console.log('[MuJoCo] Bodies updated to default pose (qpos0)');
  };

  const clearSceneObjects = () => {
    if (!sceneRef.current) return;

    const mujocoRoot = sceneRef.current.getObjectByName('MuJoCo Root');
    if (mujocoRoot) {
      let meshCount = 0;
      // Recursively dispose of all geometries and materials
      mujocoRoot.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          meshCount++;
          if (object.geometry) {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((material) => material.dispose());
            } else {
              object.material.dispose();
            }
          }
        }
      });

      console.log(`Cleared ${meshCount} meshes from scene`);
      sceneRef.current.remove(mujocoRoot);
    } else {
      console.log('No MuJoCo Root found to clear');
    }

    bodiesRef.current = {};
  };

  const startRenderLoop = () => {
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Render all loaded trajectories
      const currentTrajectories = trajectoriesRef.current;
      const frame = currentFrameRef.current;

      if (currentTrajectories.length > 0 && modelRef.current && mujocoRef.current) {
        currentTrajectories.forEach((traj, index) => {
          const entry = trajectoryBodiesMap.current.get(traj.id);
          if (!entry || !traj.data.qpos.length) return;

          const trajectoryFrame = Math.min(frame, traj.data.qpos.length - 1);
          const qposData = traj.data.qpos[trajectoryFrame];

          if (qposData && qposData.length === modelRef.current!.nq) {
            console.log(`[TENDON DEBUG] Render loop: Updating trajectory ${index} (${traj.name}, root: ${entry.root.name}), passing undefined as mujocoRoot`);
            applyQposAndUpdateBodies(
              qposData,
              mujocoRef.current,
              modelRef.current,
              entry.data,
              entry.bodies,
              undefined, // Don't pass root - skip tendon/flex rendering on trajectory clones
              false // swizzle=false for Y-up coordinate system
            );
          }
        });
      }

      // Update camera from MuJoCo if using a MuJoCo camera
      // Use ref instead of closure variable to access latest camera ID
      if (activeCameraIdRef.current >= 0 && cameraRef.current && dataRef.current && modelRef.current) {
          const camId = activeCameraIdRef.current;
          updateCameraFromMuJoCo(cameraRef.current, dataRef.current, modelRef.current, camId);
        }

      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        const renderer = rendererRef.current;

        // Disable autoClear to manually control clearing
        renderer.autoClear = false;

        // Clear everything first
        renderer.clear();

        // Render main scene with full viewport
        renderer.setViewport(0, 0, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
        renderer.render(sceneRef.current, cameraRef.current);

        // Render axis helper in top-right corner (if enabled)
        const showMoving = options?.showMovingAxes ?? true;
        if (showMoving && axisSceneRef.current && axisCameraRef.current) {
          const size = 128; // Size of the inset viewport in pixels
          const margin = 10;

          // Update axes group to match main camera rotation
          const axesGroup = axisSceneRef.current.getObjectByName('AxesGroup');
          if (axesGroup) {
            axesGroup.quaternion.copy(cameraRef.current.quaternion).invert();
          }

          // Set viewport for inset (top-right corner)
          const canvasWidth = renderer.domElement.clientWidth;
          const canvasHeight = renderer.domElement.clientHeight;

          renderer.clearDepth(); // Clear depth buffer for overlay
          renderer.setScissorTest(true);
          renderer.setScissor(
            canvasWidth - size - margin,
            canvasHeight - size - margin,
            size,
            size
          );
          renderer.setViewport(
            canvasWidth - size - margin,
            canvasHeight - size - margin,
            size,
            size
          );

          renderer.render(axisSceneRef.current, axisCameraRef.current);

          // Reset scissor test
          renderer.setScissorTest(false);
        }
      }
    };

    animate();
  };

  // Expose recordVideo function to parent via ref
  useImperativeHandle(ref, () => ({
    recordVideo: async (onProgress?: (progress: number) => void) => {
      // Validate prerequisites
      if (trajectoriesRef.current.length === 0) {
        throw new Error('No trajectories loaded');
      }
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) {
        throw new Error('Scene not initialized');
      }
      if (!modelRef.current || !mujocoRef.current) {
        throw new Error('MuJoCo not initialized');
      }

      console.log('[VIDEO] Starting video recording');

      // Use the longest trajectory to determine video duration
      const trajectories = trajectoriesRef.current;
      const totalTrajectoryFrames = trajectories.reduce((max, traj) =>
        Math.max(max, traj.data.frameCount), 0);
      const trajectoryFrameRate = trajectories[0].data.frameRate; // Use first trajectory's frame rate

      // Calculate trajectory duration in seconds
      const trajectoryDuration = totalTrajectoryFrames / trajectoryFrameRate;

      // Calculate how many video frames we need at 30fps
      const videoFrameRate = 30; // Target video fps
      const totalVideoFrames = Math.round(trajectoryDuration * videoFrameRate);

      console.log(`[VIDEO] ${trajectories.length} trajectories: max ${totalTrajectoryFrames} frames at ${trajectoryFrameRate} Hz = ${trajectoryDuration.toFixed(2)}s`);
      console.log(`[VIDEO] Video: ${totalVideoFrames} frames at ${videoFrameRate} fps`);

      // Create off-screen renderer (matches main renderer's color space)
      const recordingRenderer = createRecordingRenderer();

      // Clone camera with 16:9 aspect ratio
      const recordingCamera = createRecordingCamera(cameraRef.current);

      try {
        // Create streaming recorder (uses Mediabunny + WebCodecs)
        const recorder = new StreamingRecorder({
          width: 1920,
          height: 1080,
          fps: videoFrameRate
        });

        // Start streaming encoder
        await recorder.start();
        console.log('[VIDEO] Streaming recorder ready');

        // Render and encode frames incrementally (streaming - no buffering!)
        console.log('[VIDEO] Rendering and encoding frames (streaming)...');
        for (let videoFrame = 0; videoFrame < totalVideoFrames; videoFrame++) {
          // Calculate which trajectory frame corresponds to this video frame
          const trajectoryTime = (videoFrame / videoFrameRate);
          const trajectoryFrameIndex = Math.min(
            Math.round(trajectoryTime * trajectoryFrameRate),
            totalTrajectoryFrames - 1
          );

          // Render all loaded trajectories
          trajectories.forEach(traj => {
            const entry = trajectoryBodiesMap.current.get(traj.id);
            if (!entry || trajectoryFrameIndex >= traj.data.qpos.length) return;

            const qposData = traj.data.qpos[trajectoryFrameIndex];
            if (qposData && qposData.length === modelRef.current!.nq) {
              applyQposAndUpdateBodies(
                qposData,
                mujocoRef.current,
                modelRef.current,
                entry.data,
                entry.bodies,
                undefined, // Don't pass root - skip tendon/flex rendering on trajectory clones
                false
              );
            }
          });

          // Update MuJoCo camera if active
          if (activeCameraIdRef.current >= 0) {
            updateCameraFromMuJoCo(recordingCamera, dataRef.current, modelRef.current, activeCameraIdRef.current);
          } else {
            // For free camera, copy transform from main camera
            recordingCamera.position.copy(cameraRef.current.position);
            recordingCamera.quaternion.copy(cameraRef.current.quaternion);
            recordingCamera.updateMatrixWorld();
          }

          // Render frame to off-screen canvas
          recordingRenderer.render(sceneRef.current, recordingCamera);

          // Add frame to encoder (encodes immediately, no buffering!)
          await recorder.addFrame(recordingRenderer.domElement);

          // Report progress (0-100%)
          const progress = ((videoFrame + 1) / totalVideoFrames) * 100;
          if (onProgress) {
            onProgress(progress);
          }
          if (videoFrame % 10 === 0 || videoFrame === totalVideoFrames - 1) {
            console.log(`[VIDEO] Encoded ${videoFrame + 1}/${totalVideoFrames} frames (${Math.round(progress)}%)`);
          }
        }

        // Finalize video (flush encoder and complete MP4 file)
        console.log('[VIDEO] Finalizing MP4...');
        const blob = await recorder.stop();

        // Download video
        const filename = `trajectory_${Date.now()}.mp4`;
        downloadBlob(blob, filename);

        console.log('[VIDEO] Video saved:', filename, `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

      } finally {
        // Cleanup
        recordingRenderer.dispose();

        console.log('[VIDEO] Recording complete, resources cleaned up');
      }
    }
  }));

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-10">
          <div className="text-white text-lg">Loading MuJoCo...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-10">
          <div className="text-red-400 text-lg">{error}</div>
        </div>
      )}
    </div>
  );
});

export default MuJoCoViewer;
