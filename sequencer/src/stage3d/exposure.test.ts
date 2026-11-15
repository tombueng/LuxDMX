// @vitest-environment happy-dom
// The exposure meter reads its tiny copy back a frame or two after asking for it, never while the
// card is busy with a view switch or a new size: hold(n) puts the read off n frames (it waited 26 ms
// for the card right after a switch to Live).
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ExposureMeter } from './exposure';

function fakeRenderer() {
  const gl = {
    PIXEL_PACK_BUFFER: 1, STREAM_READ: 2, RGBA: 3, UNSIGNED_BYTE: 4, SYNC_GPU_COMMANDS_COMPLETE: 5, TIMEOUT_EXPIRED: 6, CONDITION_SATISFIED: 7,
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {}, deleteSync: () => {}, deleteBuffer: () => {},
    readPixels: vi.fn(), getBufferSubData: vi.fn(), fenceSync: () => ({}), clientWaitSync: () => 7,
  };
  const r = { getContext: () => gl, getRenderTarget: () => null, setRenderTarget: () => {}, render: () => {} };
  return { gl, r: r as unknown as THREE.WebGLRenderer };
}
const read = new THREE.WebGLRenderTarget(4, 4);

describe('the exposure meter\'s read', () => {
  it('a frame after it asked, normally', () => {
    const { gl, r } = fakeRenderer(), m = new ExposureMeter(5);
    for (let i = 0; i < 5; i++) m.render(r, read, read);
    expect(gl.readPixels).toHaveBeenCalledTimes(1);
    m.render(r, read, read);
    expect(gl.getBufferSubData).toHaveBeenCalledTimes(1);
  });
  it('held: not for those frames, then the read it was waiting for', () => {
    const { gl, r } = fakeRenderer(), m = new ExposureMeter(5);
    for (let i = 0; i < 5; i++) m.render(r, read, read);
    m.hold(10);
    for (let i = 0; i < 10; i++) m.render(r, read, read);
    expect(gl.getBufferSubData).not.toHaveBeenCalled();
    expect(gl.readPixels).toHaveBeenCalledTimes(1);
    m.render(r, read, read);
    expect(gl.getBufferSubData).toHaveBeenCalledTimes(1);
  });
});
