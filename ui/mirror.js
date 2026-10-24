// mirror.js - a flat mirror for the 3D room (a "planar reflection").
//
// How it works, simply: every frame, a second camera is placed where your camera would be
// if it stood *behind* the mirror (mirrored through the glass). What that camera sees is
// drawn into a texture, and the mirror shows that texture. Same idea as three.js' Reflector.
import * as THREE from "three";

const VERT = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = textureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const FRAG = /* glsl */`
  uniform vec3 color;
  uniform sampler2D tDiffuse;
  varying vec4 vUv;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 base = texture2DProj(tDiffuse, vUv);
    gl_FragColor = vec4(base.rgb * color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Mirror extends THREE.Mesh {
  /** geometry: usually a PlaneGeometry (the mirror faces its +Z side). tint: slightly grey = real glass. */
  constructor(geometry, { tint = 0xd8dde3, resolution = 1024, clipBias = 0.003 } = {}) {
    const target = new THREE.WebGLRenderTarget(resolution, resolution, { samples: 4, type: THREE.HalfFloatType });
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(tint) }, tDiffuse: { value: target.texture }, textureMatrix: { value: new THREE.Matrix4() } },
      vertexShader: VERT, fragmentShader: FRAG,
    });
    super(geometry, material);
    this.isMirror = true;
    this.type = "Mirror";
    this.target = target;
    this.clipBias = clipBias;
    this.camera = new THREE.PerspectiveCamera();
    const v = {
      plane: new THREE.Plane(), normal: new THREE.Vector3(), mirrorPos: new THREE.Vector3(), camPos: new THREE.Vector3(),
      rot: new THREE.Matrix4(), lookAt: new THREE.Vector3(0, 0, -1), clip: new THREE.Vector4(), view: new THREE.Vector3(),
      tgt: new THREE.Vector3(), q: new THREE.Vector4(),
    };
    this.onBeforeRender = (renderer, scene, camera) => {
      if (camera === this.camera || this._busy) return;                 // never reflect inside the reflection
      v.mirrorPos.setFromMatrixPosition(this.matrixWorld);
      v.camPos.setFromMatrixPosition(camera.matrixWorld);
      v.rot.extractRotation(this.matrixWorld);
      v.normal.set(0, 0, 1).applyMatrix4(v.rot);
      v.view.subVectors(v.mirrorPos, v.camPos);
      if (v.view.dot(v.normal) > 0) return;                              // we're behind the mirror
      v.view.reflect(v.normal).negate().add(v.mirrorPos);
      v.rot.extractRotation(camera.matrixWorld);
      v.lookAt.set(0, 0, -1).applyMatrix4(v.rot).add(v.camPos);
      v.tgt.subVectors(v.mirrorPos, v.lookAt).reflect(v.normal).negate().add(v.mirrorPos);
      const vc = this.camera;
      vc.position.copy(v.view);
      vc.up.set(0, 1, 0).applyMatrix4(v.rot).reflect(v.normal);
      vc.lookAt(v.tgt);
      vc.far = camera.far;
      vc.updateMatrixWorld();
      vc.projectionMatrix.copy(camera.projectionMatrix);
      // maps the mirror's surface to the reflection texture
      material.uniforms.textureMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse).multiply(this.matrixWorld);
      // cut away everything behind the glass (oblique near plane)
      v.plane.setFromNormalAndCoplanarPoint(v.normal, v.mirrorPos).applyMatrix4(vc.matrixWorldInverse);
      v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
      const p = vc.projectionMatrix.elements;
      v.q.set((Math.sign(v.clip.x) + p[8]) / p[0], (Math.sign(v.clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
      v.clip.multiplyScalar(2 / v.clip.dot(v.q));
      p[2] = v.clip.x; p[6] = v.clip.y; p[10] = v.clip.z + 1 - this.clipBias; p[14] = v.clip.w;
      // draw the reflection
      this._busy = true;
      this.visible = false;
      const prevTarget = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.autoUpdate, prevXr = renderer.xr.enabled;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(target);
      renderer.state.buffers.depth.setMask(true);
      if (renderer.autoClear === false) renderer.clear();
      renderer.render(scene, vc);
      renderer.xr.enabled = prevXr;
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.setRenderTarget(prevTarget);
      if (camera.viewport !== undefined) renderer.state.viewport(camera.viewport);
      this.visible = true;
      this._busy = false;
    };
  }

  dispose() { this.target.dispose(); this.material.dispose(); this.geometry.dispose(); }
}
