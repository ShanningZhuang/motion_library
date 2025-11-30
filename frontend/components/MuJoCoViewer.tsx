'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  loadMuJoCo,
  loadModelFromXML,
  cleanupModel,
  getDefaultSceneXML,
  MuJoCoModule,
} from '@/lib/mujoco-loader';

interface MuJoCoViewerProps {
  modelXML?: string;
  onModelLoaded?: () => void;
  onError?: (error: string) => void;
}

export default function MuJoCoViewer({ modelXML, onModelLoaded, onError }: MuJoCoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const mujocoRef = useRef<MuJoCoModule | null>(null);
  const modelRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const bodiesRef = useRef<{ [key: number]: THREE.Group }>({});
  const animationIdRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

        // Set up camera
        const camera = new THREE.PerspectiveCamera(
          45,
          width / height,
          0.001,
          100
        );
        camera.position.set(2.0, 1.7, 1.7);
        scene.add(camera);
        cameraRef.current = camera;

        // Set up lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(0, 3, 3);
        directionalLight.castShadow = true;
        scene.add(directionalLight);

        // Set up renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height);

        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        containerRef.current!.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Set up orbit controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0.7, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true;
        controls.update();
        controlsRef.current = controls;

        // Load default empty scene
        const defaultXML = getDefaultSceneXML();
        const { model, data } = loadModelFromXML(mujoco, defaultXML);
        modelRef.current = model;
        dataRef.current = data;

        // Create scene objects
        createSceneObjects(scene, mujoco, model, data);

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
        clearSceneObjects();

        // Load new model
        const { model, data } = loadModelFromXML(mujocoRef.current!, modelXML);
        modelRef.current = model;
        dataRef.current = data;

        // Create scene objects for new model
        createSceneObjects(sceneRef.current!, mujocoRef.current!, model, data);

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
  }, [modelXML]);

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
    const mujocoRoot = new THREE.Group();
    mujocoRoot.name = 'MuJoCo Root';
    scene.add(mujocoRoot);

    const bodies: { [key: number]: THREE.Group } = {};

    // Create bodies and geoms
    for (let g = 0; g < model.ngeom; g++) {
      // Only visualize geom groups up to 2
      if (model.geom_group[g] >= 3) continue;

      const bodyId = model.geom_bodyid[g];
      const type = model.geom_type[g];
      const size = [
        model.geom_size[g * 3 + 0],
        model.geom_size[g * 3 + 1],
        model.geom_size[g * 3 + 2],
      ];

      // Create body group if it doesn't exist
      if (!bodies[bodyId]) {
        bodies[bodyId] = new THREE.Group();
        bodies[bodyId].name = `body_${bodyId}`;
      }

      // Create geometry based on type
      let geometry: THREE.BufferGeometry;

      if (type === mujoco.mjtGeom.mjGEOM_SPHERE.value) {
        geometry = new THREE.SphereGeometry(size[0], 20, 20);
      } else if (type === mujoco.mjtGeom.mjGEOM_CAPSULE.value) {
        geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2.0, 20, 20);
      } else if (type === mujoco.mjtGeom.mjGEOM_CYLINDER.value) {
        geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2.0);
      } else if (type === mujoco.mjtGeom.mjGEOM_BOX.value) {
        geometry = new THREE.BoxGeometry(size[0] * 2.0, size[2] * 2.0, size[1] * 2.0);
      } else if (type === mujoco.mjtGeom.mjGEOM_PLANE.value) {
        geometry = new THREE.PlaneGeometry(100, 100);
      } else {
        // Default to sphere for unknown types
        geometry = new THREE.SphereGeometry(size[0] * 0.5, 20, 20);
      }

      // Get color from model
      const color = [
        model.geom_rgba[g * 4 + 0],
        model.geom_rgba[g * 4 + 1],
        model.geom_rgba[g * 4 + 2],
        model.geom_rgba[g * 4 + 3],
      ];

      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(color[0], color[1], color[2]),
        transparent: color[3] < 1.0,
        opacity: color[3],
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (type === mujoco.mjtGeom.mjGEOM_PLANE.value) {
        mesh.rotateX(-Math.PI / 2);
      }

      bodies[bodyId].add(mesh);

      // Set initial position and orientation
      getPosition(model.geom_pos, g, mesh.position);
      getQuaternion(model.geom_quat, g, mesh.quaternion);
    }

    // Add bodies to scene
    for (let b = 0; b < model.nbody; b++) {
      if (bodies[b]) {
        if (b === 0 || !bodies[0]) {
          mujocoRoot.add(bodies[b]);
        } else {
          bodies[0].add(bodies[b]);
        }
      }
    }

    bodiesRef.current = bodies;

    // Forward simulation once to get initial state
    mujoco.mj_forward(model, data);
  };

  const clearSceneObjects = () => {
    if (!sceneRef.current) return;

    const mujocoRoot = sceneRef.current.getObjectByName('MuJoCo Root');
    if (mujocoRoot) {
      sceneRef.current.remove(mujocoRoot);
    }

    bodiesRef.current = {};
  };

  const startRenderLoop = () => {
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Update body transforms from MuJoCo data
      if (dataRef.current && modelRef.current) {
        for (let b = 0; b < modelRef.current.nbody; b++) {
          if (bodiesRef.current[b]) {
            getPosition(dataRef.current.xpos, b, bodiesRef.current[b].position);
            getQuaternion(dataRef.current.xquat, b, bodiesRef.current[b].quaternion);
            bodiesRef.current[b].updateWorldMatrix(false, false);
          }
        }
      }

      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animate();
  };

  // Helper functions for coordinate conversion (MuJoCo -> Three.js)
  const getPosition = (buffer: Float32Array | Float64Array, index: number, target: THREE.Vector3) => {
    // Swizzle coordinates: MuJoCo (x,y,z) -> Three.js (x,z,-y)
    target.set(buffer[index * 3 + 0], buffer[index * 3 + 2], -buffer[index * 3 + 1]);
  };

  const getQuaternion = (
    buffer: Float32Array | Float64Array,
    index: number,
    target: THREE.Quaternion
  ) => {
    // Swizzle quaternion: MuJoCo (w,x,y,z) -> Three.js (x,y,z,w) with coordinate conversion
    target.set(
      -buffer[index * 4 + 1],
      -buffer[index * 4 + 3],
      buffer[index * 4 + 2],
      -buffer[index * 4 + 0]
    );
  };

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
      {!loading && !error && !modelXML && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-gray-400 text-lg">Select a model to begin</div>
        </div>
      )}
    </div>
  );
}
