// Exposure like a camera's: how bright the scene is (before the glow and the tone mapping) is
// measured on a tiny copy every few frames, read back without stalling the graphics card, and the
// exposure eases towards what keeps the picture neither blown out nor murky. Looking into a wall
// of lights from the stage then exposes down, a dark look exposes up a little.
//
// The read: the copy (its log brightness as bytes) into a pixel buffer, a fence after it, and the
// bytes taken a frame or two later once the fence says the card is done. (three's own async read
// asked the card which formats it reads back first, every time: a call that waits for the card,
// about a sixth of the page's time with the 3D stage open.)
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const W = 32, H = 18;
// (the log brightness from -LOG_SPAN to +LOG_SPAN, as a byte: a tenth of a stop a step)
const LOG_SPAN = 10;
export class ExposureMeter extends Pass {
  private rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
  private pbo: WebGLBuffer | null = null;
  private sync: WebGLSync | null = null;
  private bytes = new Uint8Array(W * H * 4);
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  private frame = 0;
  logAvg = Math.log(0.2);            // the scene's log-average brightness (linear light)
  constructor(private every = 8) {
    super();
    this.needsSwap = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2(1 / (W * 4), 1 / (H * 4)) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // 4 x 4 samples per pixel of the tiny copy, as the log of their brightness (a few bright
      // spots don't decide it alone)
      fragmentShader: `#define LOG_SPAN ${LOG_SPAN.toFixed(1)}
        uniform sampler2D tDiffuse; uniform vec2 uStep; varying vec2 vUv;
        void main() {
          float s = 0.0;
          for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
            vec3 c = texture2D(tDiffuse, vUv + (vec2(float(x), float(y)) - 1.5) * uStep).rgb;
            float l = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
            s += log(clamp(l, 1e-4, 1e4));
          }
          gl_FragColor = vec4(clamp((s / 16.0 + LOG_SPAN) / (2.0 * LOG_SPAN), 0.0, 1.0), 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    // the last read, when the card has finished it (asked without waiting)
    if (this.sync) {
      if (gl.clientWaitSync(this.sync, 0, 0) === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(this.sync); this.sync = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.bytes); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      let s = 0;
      for (let i = 0; i < W * H; i++) s += (this.bytes[i * 4] / 255) * 2 * LOG_SPAN - LOG_SPAN;
      this.logAvg = s / (W * H);
    }
    if (++this.frame % this.every) return;
    this.mat.uniforms.tDiffuse.value = read.texture;
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt); this.quad.render(renderer);
    // (into the pixel buffer: readPixels returns at once, the fence says when it's there)
    if (!this.pbo) { this.pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, this.bytes.byteLength, gl.STREAM_READ); }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    renderer.setRenderTarget(was);
    this.gl = gl;
  }
  private gl: WebGL2RenderingContext | null = null;
  // the exposure for this scene: half way (in stops) from where it is to what would put its middle
  // brightness at `key`, like an eye or a camera that doesn't quite adapt all the way
  target(key: number, lo = 0.12, hi = 1.4) { return Math.min(hi, Math.max(lo, Math.sqrt(key / Math.exp(this.logAvg)))); }
  dispose() {
    if (this.gl) { if (this.sync) this.gl.deleteSync(this.sync); if (this.pbo) this.gl.deleteBuffer(this.pbo); }
    this.rt.dispose(); this.mat.dispose(); this.quad.dispose();
  }
}
