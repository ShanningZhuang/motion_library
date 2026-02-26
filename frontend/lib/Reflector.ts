// Reflector utility for creating reflective plane surfaces
// Converted from mujoco_wasm/src/utils/Reflector.js

import {
  Color,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  HalfFloatType,
  NoToneMapping,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  BufferGeometry,
  WebGLRenderer,
  Scene,
  Camera,
  Texture,
} from 'three';

interface ReflectorOptions {
  color?: number | Color;
  textureWidth?: number;
  textureHeight?: number;
  clipBias?: number;
  shader?: any;
  multisample?: number;
  texture?: Texture;
}

export class Reflector extends Mesh {
  isReflector: boolean = true;
  type: string = 'Reflector';
  camera: PerspectiveCamera;

  constructor(geometry: BufferGeometry, options: ReflectorOptions = {}) {
    super(geometry);

    this.camera = new PerspectiveCamera();

    const scope = this;

    const color = options.color !== undefined ? new Color(options.color) : new Color(0x7F7F7F);
    const textureWidth = options.textureWidth || 1024;
    const textureHeight = options.textureHeight || 1024;
    const clipBias = options.clipBias || 0;
    const multisample = options.multisample !== undefined ? options.multisample : 4;
    const blendTexture = options.texture || undefined;

    //

    const reflectorPlane = new Plane();
    const normal = new Vector3();
    const reflectorWorldPosition = new Vector3();
    const cameraWorldPosition = new Vector3();
    const rotationMatrix = new Matrix4();
    const lookAtPosition = new Vector3(0, 0, -1);
    const clipPlane = new Vector4();

    const view = new Vector3();
    const target = new Vector3();
    const q = new Vector4();

    const textureMatrix = new Matrix4();
    const virtualCamera = this.camera;

    const renderTarget = new WebGLRenderTarget(textureWidth, textureHeight, {
      samples: multisample,
      type: HalfFloatType
    });

    this.material = new MeshPhysicalMaterial({ map: blendTexture });
    (this.material as any).uniforms = {
      tDiffuse: { value: renderTarget.texture },
      textureMatrix: { value: textureMatrix }
    };

    this.material.onBeforeCompile = (shader) => {
      // Vertex Shader: Set Vertex Positions to the Unwrapped UV Positions
      let bodyStart = shader.vertexShader.indexOf('void main() {');
      shader.vertexShader =
        shader.vertexShader.slice(0, bodyStart) +
        '\nuniform mat4 textureMatrix;\nvarying vec4 vUv3;\n' +
        shader.vertexShader.slice(bodyStart - 1, -1) +
        '	vUv3 = textureMatrix * vec4( position, 1.0 ); }';

      // Fragment Shader: Set Pixels to blend with reflection
      bodyStart = shader.fragmentShader.indexOf('void main() {');
      shader.fragmentShader =
        '\nuniform sampler2D tDiffuse; \n varying vec4 vUv3;\n' +
        shader.fragmentShader.slice(0, bodyStart) +
        shader.fragmentShader.slice(bodyStart - 1, -1) +
        `	gl_FragColor = vec4( mix( texture2DProj( tDiffuse,  vUv3 ).rgb, gl_FragColor.rgb , 0.85), 1.0 );
				}`;

      // Set the uniforms
      shader.uniforms.tDiffuse = { value: renderTarget.texture };
      shader.uniforms.textureMatrix = { value: textureMatrix };
      (this.material as any).uniforms = shader.uniforms;

      // Set the new Shader to this
      (this.material as any).userData.shader = shader;
    };

    this.receiveShadow = true;

    this.onBeforeRender = function (renderer: WebGLRenderer, scene: Scene, camera: Camera) {
      reflectorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
      cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

      rotationMatrix.extractRotation(scope.matrixWorld);

      normal.set(0, 0, 1);
      normal.applyMatrix4(rotationMatrix);

      view.subVectors(reflectorWorldPosition, cameraWorldPosition);

      // Avoid rendering when reflector is facing away
      if (view.dot(normal) > 0) return;

      view.reflect(normal).negate();
      view.add(reflectorWorldPosition);

      rotationMatrix.extractRotation(camera.matrixWorld);

      lookAtPosition.set(0, 0, -1);
      lookAtPosition.applyMatrix4(rotationMatrix);
      lookAtPosition.add(cameraWorldPosition);

      target.subVectors(reflectorWorldPosition, lookAtPosition);
      target.reflect(normal).negate();
      target.add(reflectorWorldPosition);

      virtualCamera.position.copy(view);
      virtualCamera.up.set(0, 1, 0);
      virtualCamera.up.applyMatrix4(rotationMatrix);
      virtualCamera.up.reflect(normal);
      virtualCamera.lookAt(target);

      virtualCamera.far = (camera as PerspectiveCamera).far; // Used in WebGLBackground

      virtualCamera.updateMatrixWorld();
      virtualCamera.projectionMatrix.copy((camera as PerspectiveCamera).projectionMatrix);

      // Update the texture matrix
      textureMatrix.set(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
      );
      textureMatrix.multiply(virtualCamera.projectionMatrix);
      textureMatrix.multiply(virtualCamera.matrixWorldInverse);
      textureMatrix.multiply(scope.matrixWorld);

      // Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
      // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
      reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
      reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);

      clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);

      const projectionMatrix = virtualCamera.projectionMatrix;

      q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
      q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
      q.z = -1.0;
      q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

      // Calculate the scaled plane vector
      clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

      // Replacing the third row of the projection matrix
      projectionMatrix.elements[2] = clipPlane.x;
      projectionMatrix.elements[6] = clipPlane.y;
      projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
      projectionMatrix.elements[14] = clipPlane.w;

      // Render
      scope.visible = false;

      const currentRenderTarget = renderer.getRenderTarget();

      const currentXrEnabled = renderer.xr.enabled;
      const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
      const currentOutputEncoding = renderer.outputColorSpace;
      const currentToneMapping = renderer.toneMapping;

      renderer.xr.enabled = false; // Avoid camera modification
      renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows
      renderer.outputColorSpace = LinearSRGBColorSpace;
      renderer.toneMapping = NoToneMapping;

      renderer.setRenderTarget(renderTarget);

      renderer.state.buffers.depth.setMask(true); // make sure the depth buffer is writable so it can be properly cleared, see #18897

      if (renderer.autoClear === false) renderer.clear();
      
      // Temporarily hide background to avoid reflecting sky colors
      const originalBackground = scene.background;
      scene.background = null; // Don't render background in reflection
      
      renderer.render(scene, virtualCamera);
      
      // Restore original background
      scene.background = originalBackground;

      renderer.xr.enabled = currentXrEnabled;
      renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
      renderer.outputColorSpace = currentOutputEncoding;
      renderer.toneMapping = currentToneMapping;

      renderer.setRenderTarget(currentRenderTarget);

      // Restore viewport
      const viewport = (camera as any).viewport;

      if (viewport !== undefined) {
        renderer.state.viewport(viewport);
      }

      scope.visible = true;
    };
  }

  getRenderTarget(): WebGLRenderTarget {
    return (this.material as any).uniforms?.tDiffuse?.value?.image ?
      (this.material as any).uniforms.tDiffuse.value :
      new WebGLRenderTarget(1024, 1024);
  }

  dispose(): void {
    const renderTarget = this.getRenderTarget();
    if (renderTarget) {
      renderTarget.dispose();
    }
    if (this.material) {
      if (Array.isArray(this.material)) {
        this.material.forEach(m => m.dispose());
      } else {
        this.material.dispose();
      }
    }
  }
}
