// Exposure like a camera's: how bright the scene is (before the glow and the tone mapping) is
// measured on a tiny copy every few frames, read back without stalling the graphics card, and the
// exposure eases towards what keeps the picture neither blown out nor murky. Looking into a wall
// of lights from the stage then exposes down, a dark look exposes up a little.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const W = 32, H = 18;
export class ExposureMeter extends Pass {
  private rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  private frame = 0;
  private busy = false;
  private buf = new Uint16Array(W * H * 4);
  logAvg = Math.log(0.2);            // the scene's log-average brightness (linear light)
  constructor(private every = 8) {
    super();
    this.needsSwap = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2(1 / (W * 4), 1 / (H * 4)) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // 4 x 4 samples per pixel of the tiny copy, as the log of their brightness (a few bright
      // spots don't decide it alone)
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uStep; varying vec2 vUv;
        void main() {
          float s = 0.0;
          for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
            vec3 c = texture2D(tDiffuse, vUv + (vec2(float(x), float(y)) - 1.5) * uStep).rgb;
            float l = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
            s += log(clamp(l, 1e-4, 1e4));
          }
          gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (++this.frame % this.every || this.busy) return;
    this.mat.uniforms.tDiffuse.value = read.texture;
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt); this.quad.render(renderer); renderer.setRenderTarget(was);
    this.busy = true;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const done = renderer.readRenderTargetPixelsAsync(this.rt, 0, 0, W, H, this.buf);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);      // (leave no pixel buffer bound for other reads)
    done.then(() => {
      let s = 0, n = 0;
      for (let i = 0; i < W * H; i++) { const v = THREE.DataUtils.fromHalfFloat(this.buf[i * 4]); if (Number.isFinite(v)) { s += v; n++; } }
      if (n) this.logAvg = s / n;
    }).catch(() => undefined).finally(() => { this.busy = false; gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); });
  }
  // the exposure for this scene: half way (in stops) from where it is to what would put its middle
  // brightness at `key`, like an eye or a camera that doesn't quite adapt all the way
  target(key: number, lo = 0.12, hi = 1.4) { return Math.min(hi, Math.max(lo, Math.sqrt(key / Math.exp(this.logAvg)))); }
  dispose() { this.rt.dispose(); this.mat.dispose(); this.quad.dispose(); }
}
