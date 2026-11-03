<script lang="ts">
  // Just the lights being set up, in 3D: the 3D stage's own models and beams (stage3d/rig.ts), a
  // floor under them, what they hang on (a piece of truss, a tower for one on its side), a person
  // for scale and the marks on the stage to point a head at. Drag to look round it. Loaded only
  // when the setup is open (three.js is big); its own small canvas, let go when it closes.
  //
  // The 3D stage's beams land on the room's deck (geometry.ts hitFloor). Here there is one floor,
  // the one under the light: the picture is moved well off to the side of the room (where there is
  // no deck), with that floor at 0, so the beams land on it.
  import { onDestroy, onMount, untrack } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
  import { Rig, type RigFixture } from '../stage3d/rig';
  import { trussPiece } from '../stage3d/rooms';
  import { crewMember } from '../stage3d/gear';
  import { groundAt, pivotOf, type Room, type V3 } from '../stage3d/geometry';
  import { dirOf, upOf } from '../model/fixtureSetup';
  import { load } from '../perf/load.svelte';
  import type { Resolved } from '../model/types';

  let { lights, values, focus, room, marks = [] }: {
    lights: RigFixture[]; values: Record<string, Resolved>; focus: string; room: Room;
    marks?: { p: V3; on: boolean }[];
  } = $props();

  const OFF = 200;                // metres off to the side: no deck there
  let host = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let failed = $state(false);
  let renderer: THREE.WebGLRenderer | undefined, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls;
  let rig: Rig, gear: THREE.Group, markGroup: THREE.Group, person: THREE.Object3D | undefined, span: THREE.Mesh | undefined;
  let raf = 0, ro: ResizeObserver | undefined, ratio = 0;
  const trussMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.85, roughness: 0.35 });
  const markOn = new THREE.MeshBasicMaterial({ color: 0xffaa1c, toneMapped: false }), markOff = new THREE.MeshBasicMaterial({ color: 0x6b7280, toneMapped: false });

  // where the picture's 0 is: the light set up, on its floor, moved off to the side
  const fl = $derived(lights.find((l) => l.id === focus) ?? lights[0]);
  const origin = $derived.by((): V3 => fl ? { x: OFF - fl.p.x, y: -groundAt(fl.p.x, fl.p.z, room), z: -fl.p.z } : { x: OFF, y: 0, z: 0 });
  const shift = (p: V3, o: V3): V3 => ({ x: p.x + o.x, y: p.y + o.y, z: p.z + o.z });
  const shifted = $derived(lights.map((l) => ({ ...l, p: shift(l.p, origin) })));

  onMount(() => {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch { failed = true; return; }
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d12);
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 300);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    pm.dispose();
    scene.add(new THREE.HemisphereLight(0x9aa6c0, 0x1a1a1e, 1.1));
    const key = new THREE.DirectionalLight(0xdfe6f5, 1.1); key.position.set(OFF - 4, 9, 7); key.target.position.set(OFF, 0, 0); scene.add(key, key.target);
    // the floor: dark, so the beam's pool shows, with a metre grid
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 0.9 }));
    floor.position.set(OFF, -0.002, 0); scene.add(floor);
    const grid = new THREE.GridHelper(20, 20, 0x3a404c, 0x262a33); grid.position.set(OFF, 0.001, 0); scene.add(grid);
    gear = new THREE.Group(); scene.add(gear);
    markGroup = new THREE.Group(); scene.add(markGroup);
    rig = new Rig(); scene.add(rig.group);
    controls = new OrbitControls(camera, canvas!);
    controls.enableDamping = true; controls.dampingFactor = 0.1; controls.minDistance = 0.5; controls.maxDistance = 40; controls.zoomToCursor = true;
    frameIt();
    ro = new ResizeObserver(resize); ro.observe(host!); resize();
    raf = requestAnimationFrame(frame);
    if (import.meta.env.DEV) (window as unknown as { __setup3d: unknown }).__setup3d = {
      // where a light's beam goes now (world directions: the same as on the 3D stage)
      beam: (id: string) => { const i = shifted.findIndex((l) => l.id === id), l = rig.lit.find((x) => x.key === i); return l ? { x: l.d.x, y: l.d.y, z: l.d.z } : null; },
      head: (id: string) => rig.headOf(id) ?? null,
      stats: () => ({ lights: shifted.length, beams: rig.beamCount, ms: Math.round(ms * 100) / 100 }),
    };
  });

  // the lights: built again when they come or go, else only placed
  let shape: string | null = null;
  $effect(() => {
    const list = shifted, sig = list.map((f) => `${f.id}:${f.look}:${f.cells}`).join();
    if (!rig) return;
    untrack(() => { if (sig !== shape) { shape = sig; rig.build(list); } else rig.place(list); dress(list); });
  });
  // the marks on the floor
  $effect(() => {
    const m = marks, o = origin;
    if (!markGroup) return;
    untrack(() => {
      for (const c of [...markGroup.children]) { markGroup.remove(c); (c as THREE.Mesh).geometry.dispose(); }
      for (const k of m) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 28).rotateX(-Math.PI / 2), k.on ? markOn : markOff);
        const p = shift(k.p, o); ring.position.set(p.x, p.y + 0.012, p.z); markGroup.add(ring);
        const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.04).rotateX(-Math.PI / 2), k.on ? markOn : markOff);
        cross.position.copy(ring.position); markGroup.add(cross);
        const c2 = cross.clone(); c2.rotation.y = Math.PI / 2; markGroup.add(c2);
      }
    });
  });
  // the camera goes with the light when it's mounted somewhere else (hung, then standing)
  let lastAt: THREE.Vector3 | null = null;
  $effect(() => {
    const f = shifted.find((l) => l.id === focus);
    if (!f || !controls) return;
    const piv = pivotOf(f.p, f.rot), at = new THREE.Vector3(piv.x, piv.y, piv.z);
    untrack(() => {
      if (lastAt && lastAt.distanceToSquared(at) > 1e-6) { const d = at.clone().sub(lastAt); camera.position.add(d); controls.target.add(d); controls.update(); }
      lastAt = at;
    });
  });

  // what each light hangs on: a piece of truss over a hung one, a tower behind one on its side
  function dress(list: RigFixture[]) {
    for (const c of [...gear.children]) { gear.remove(c); if (!c.userData.shared) (c as THREE.Mesh).geometry.dispose(); }
    for (const l of list) {
      const up = upOf(l.rot), d = dirOf(up);
      if (l.kind === 'mover' && d && d !== 'up' && d !== 'down') {
        // on its side: a 0.3 m upright behind its base, from the floor to above it
        const b = { x: l.p.x - up.x * 0.17, z: l.p.z - up.z * 0.17 };
        gear.add(trussPiece([[b.x, 0, b.z], [b.x, Math.max(1, l.p.y + 0.8), b.z]], trussMat));
      } else if (l.p.y > 1.4 && !(l.kind === 'mover' && d === 'up')) {
        // hung: a 3 m piece of truss over it, across the stage (one shape for them all)
        span ??= trussPiece([[0, 0, 0], [3, 0, 0]], trussMat);
        const m = new THREE.Mesh(span.geometry, trussMat);
        m.quaternion.copy(span.quaternion); m.position.set(l.p.x - 1.5, l.p.y + 0.35 + 0.15, l.p.z); m.userData.shared = true;
        gear.add(m);
      }
    }
    // a person for scale, next to the light, on its floor (made once: a person is a lot of shapes)
    const f = list.find((l) => l.id === focus) ?? list[0];
    if (f && !person) { person = crewMember({ skin: 0xc8916c, shirt: 0x39414f, pants: 0x1f2a3d, shoes: 0x121212, hair: 0x2b1d14, style: 'short' }, 0, 0, 0, -0.5, {}).p.group; scene.add(person); }
    if (person) { person.visible = !!f; if (f) { person.position.set(f.p.x + 1.1, 0, f.p.z + 0.9); person.updateMatrix(); } }
  }

  // looking at the light from in front, a little to the side and above (far enough for a hung
  // one's beam down to the floor)
  export function frameIt(from: 'front' | 'side' | 'top' = 'front') {
    const f = shifted.find((l) => l.id === focus) ?? shifted[0];
    if (!f || !controls) return;
    const piv = pivotOf(f.p, f.rot), at = new THREE.Vector3(piv.x, piv.y * 0.6, piv.z), span = Math.max(1, ...shifted.map((l) => Math.abs(l.p.x - f.p.x)));
    const dist = Math.max(4.5, piv.y * 1.2, span * 1.6);
    const dir = from === 'side' ? new THREE.Vector3(-1, 0.25, 0.15) : from === 'top' ? new THREE.Vector3(0.02, 1, 0.12) : new THREE.Vector3(0.45, 0.22, 1);
    controls.target.copy(at); camera.position.copy(at).addScaledVector(dir.normalize(), dist); controls.update();
    lastAt = new THREE.Vector3(piv.x, piv.y, piv.z);
  }

  function resize() {
    if (!renderer || !host) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  // (the drawing quality steps down on a busy page, like the 3D stage's)
  let ms = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!renderer || document.hidden) return;
    const t0 = performance.now();
    const want = load.level >= 2 ? Math.min(2, window.devicePixelRatio || 1) : load.level === 1 ? 1 : 0.75;
    if (want !== ratio) { ratio = want; renderer.setPixelRatio(want); resize(); }
    rig.update(values, t0 / 1000, 0.75, new Set(shifted.length > 1 ? [focus] : []));
    controls.update();
    renderer.render(scene, camera);
    const dt = performance.now() - t0;
    ms = ms ? ms * 0.95 + dt * 0.05 : dt;
    load.did(dt);
  }

  onDestroy(() => {
    cancelAnimationFrame(raf); ro?.disconnect(); controls?.dispose();
    if (import.meta.env.DEV) delete (window as unknown as { __setup3d?: unknown }).__setup3d;
    // (its own context: losing it frees everything on the graphics chip; the shared textures and
    // the people's cached shapes stay for the 3D stage)
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
    span?.geometry.dispose(); trussMat.dispose(); markOn.dispose(); markOff.dispose();
  });
</script>

<div class="p3" bind:this={host}>
  {#if failed}<p class="faint none">No 3D picture in this browser (WebGL is off).</p>{/if}
  <div class="cv" role="img" aria-label="The light on its own in 3D: drag to look round it, the wheel zooms"><canvas bind:this={canvas}></canvas></div>
  <div class="views" role="group" aria-label="Look at it from">
    <button class="ghost" onclick={() => frameIt('front')}>Front</button>
    <button class="ghost" onclick={() => frameIt('side')}>Side</button>
    <button class="ghost" onclick={() => frameIt('top')}>Above</button>
  </div>
</div>

<style>
  .p3 { position: relative; width: 100%; height: 100%; min-height: 240px; border-radius: 8px; overflow: hidden; background: #0b0d12; border: 1px solid var(--line); }
  .cv { position: absolute; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
  .views { position: absolute; left: .4rem; bottom: .4rem; display: flex; gap: .25rem; }
  .views button { padding: .15rem .5rem; font-size: .78rem; background: #0b0d12cc; min-height: 0; }
  .none { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 1rem; text-align: center; }
</style>
