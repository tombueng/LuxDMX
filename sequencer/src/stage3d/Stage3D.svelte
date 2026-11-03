<script module lang="ts">
  import type * as T from 'three';
  // The heavy part of the 3D world outlives the view that shows it. Program, Timeline and Live each
  // have a stage; going from one to the next hands the world on (the graphics context with every
  // shader built, the room, the band and the crowd, the rig), it isn't built again on every tab.
  // Switched to 2D it goes back to the graphics chip; one nobody takes up again goes after 3 minutes.
  export interface KeptWorld {
    renderer: T.WebGLRenderer; canvas: HTMLCanvasElement; scene: T.Scene; camera: T.PerspectiveCamera; wash: T.SpotLight[];
    venue: ReturnType<typeof import('./venue').buildVenue>; rig: import('./rig').Rig; particles: import('./particles').Particles;
    builtRoom: string; shape: string | null; free: () => void;
  }
  let kept: KeptWorld | null = null, keptTimer: ReturnType<typeof setTimeout> | undefined;
  // stages up now, and one that started while another was still up, waiting for its world (the
  // next view can start before the last one has closed)
  let alive = 0, waiting: ((w: KeptWorld | null) => void) | null = null;
  function park(w: KeptWorld) {
    if (waiting) { const f = waiting; waiting = null; f(w); return; }
    if (kept) kept.free();
    kept = w;
    clearTimeout(keptTimer);
    keptTimer = setTimeout(() => { kept?.free(); kept = null; }, 180_000);
  }
  function takeKept() { const w = kept; kept = null; clearTimeout(keptTimer); return w; }
  // (for the tests: whether a world is waiting)
  export const keptWorld = () => !!kept;
</script>

<script lang="ts">
  // The stage in 3D: the venue, the lights as they are right now (beams in the haze, pools on the
  // deck, moving heads turning), the effect machines' confetti, bubbles, flames and sparks. Drag to
  // look around; click a light to select it (the same selection as the 2D stage). Move and Turn
  // put a light where it really hangs (it snaps onto a truss or the deck); Aim points the selected
  // moving heads at the spot you click. Loaded only when opened (three.js is big).
  import { getContext, onDestroy, tick, untrack } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
  import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
  import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
  import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
  import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
  import { ExposureMeter } from './exposure';
  import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import { getModel, putModel } from '../store/audio';
  import type { VenueModel } from '../model/types';
  import { app } from '../app.svelte';
  import { load } from '../perf/load.svelte';
  import { ui, dismiss, dialogOpen } from '../ui/ui.svelte';
  import Icon from '../ui/Icon.svelte';
  import { canRecord, clock, extOf, FPS, megabytes, pickFormat, saveVideo, stutterNote, tallFov, Take, takeSize, VIDEO_SIZES, videoBits, videoName, type VideoSize } from './recorder';
  import { capsOf } from '../model/library';
  import { opticsOf } from '../model/fixtureSetup';
  import { buildVenue } from './venue';
  import { Rig, type RigFixture, type Sfx } from './rig';
  import type { Look } from './models';
  import { Particles } from './particles';
  import { aimAt, aimRot, beamDir, calibrate, faceBand, pivotOf, defaultPlace, DECK, D, nearestTruss, onDeck, roomOf, showRoom, TRUSS_HANG, W, worldToPlan, type Room, type Rot, type V3, type ViewKey } from './geometry';
  import { CAM_MODES, castOf, direct, isCamMode, LENS, newMemory, partAt, type CamMode, type Cast, type Part } from './director';
  import { sectionStarts } from '../timeline/beat';
  import type { Timeline } from '../model/timeline';

  let { readonly = false }: { readonly?: boolean } = $props();
  let host = $state<HTMLDivElement>();
  let cvHost = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  type Mode = 'select' | 'move' | 'turn' | 'aim' | 'calib';
  let mode = $state<Mode>('select');
  // the glow round bright lights and the haze in the air: two sliders, kept per browser
  const stored = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v === null ? d : Math.max(0, Math.min(1.5, Number(v) || 0)); } catch { return d; } };
  let glow = $state(Math.min(0.8, stored('luxdmx.seq.glow3', 0.3)));
  let hazeAmt = $state(stored('luxdmx.seq.haze', 0.45));
  // the LED screens beside the stage show the Broadcast camera live (off: the band's name, painted)
  let liveScreens = $state((() => { try { return localStorage.getItem('luxdmx.seq.screensLive') !== '0'; } catch { return true; } })());
  function setLiveScreens(on: boolean) { liveScreens = on; try { localStorage.setItem('luxdmx.seq.screensLive', on ? '1' : '0'); } catch { /* storage blocked */ } }
  // the room's own light (the night sky, the house, reflections): how much of the venue you see
  // besides your lights. On a curve like the eye's (most of the slider is the dark end); 1 is a
  // little more than it always had, it starts at about a third of that
  let ambient = $state(Math.min(1, stored('luxdmx.seq.ambient2', 0.6)));
  const ambLight = (s: number) => 1.25 * Math.pow(s, 2.2);
  let hemi: THREE.HemisphereLight | undefined, keyLight: THREE.DirectionalLight | undefined;
  let houseOf: THREE.Object3D | undefined, houseMats: THREE.MeshBasicMaterial[] = [];
  let full = $state(false);

  const SFX: Sfx[] = ['confetti', 'bubbles', 'flame', 'sparks', 'co2'];
  // the built-in room: the big stage in a hall, or a small club / pub (geometry.ts ROOMS)
  const room = $derived(roomOf(app.show.settings.stage3d?.room));
  // every light as the 3D stage needs it (rebuilt when the lights, their types or places change)
  // (a light without a 3D place of its own goes where its plan position puts it in this room)
  const fixtures = $derived.by((): RigFixture[] => app.show.fixtures.map((f) => {
    const m = app.modeOf(f.id), c = capsOf(m), k = app.kinds[f.id] ?? 'other', t = app.types.get(f.typeId);
    const def = defaultPlace(f, k, room);
    const sfx = m?.channels.find((ch) => (SFX as string[]).includes(ch.attr))?.attr as Sfx | undefined;
    const has = (a: string) => !!m?.channels.some((ch) => ch.attr === a);
    // which body it gets: a wash head has a zoom and no gobo; a blinder says so in its name
    const look: Look = sfx ?? (c.fog ? 'fog' : k === 'mover' ? (/wash/i.test(t?.model ?? '') || (has('zoom') && !has('gobo')) ? 'wash' : 'spot')
      : k === 'bar' ? 'bar' : k === 'strobe' ? 'strobe' : k === 'par' ? 'par' : /blinder/i.test(t?.model ?? '') ? 'blinder' : 'fresnel');
    return {
      id: f.id, name: f.name, kind: k, look, cells: Math.max(1, c.cells), sfx, fog: c.fog, hazer: c.fog && has('haze') && !has('fog'),
      p: f.p3 ? { ...f.p3 } : def.p, rot: f.rot ? { ...f.rot } : def.rot,
      // (the light's own pan / tilt range first, then its type's; swapped when it says so)
      optics: { ...opticsOf(f, t), swap: !!f.swapPanTilt },
    };
  }));

  let renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, gizmo: TransformControls;
  let composer: EffectComposer, bloom: UnrealBloomPass;
  let rig: Rig, particles: Particles, venue: ReturnType<typeof buildVenue>;
  let wash: THREE.SpotLight[] = [];
  // (the air is never pure black: a hall has some light in it, even between looks)
  const DARK = new THREE.Color(0x07090d), fogCol = new THREE.Color();
  const overlay = new THREE.Scene();       // drawn after the glow: the gizmo
  const meter = new ExposureMeter();
  // the middle brightness the exposure aims for (a dark venue: low key; measured so the Front view
  // of the demo sits at about the exposure it always had)
  const EXPOSURE_KEY = 0.024;
  const proxy = new THREE.Object3D();
  let raf = 0, last = performance.now(), haze = 0.45, smokeIn = 0;

  // the camera views (where each one is depends on the room: geometry.ts ROOMS)
  const VIEWS: Record<ViewKey, string> = { front: 'Front', foh: 'FOH', side: 'Side', top: 'Top', band: 'From the stage' };
  const CAM_KEY = 'luxdmx.seq.cam3d';
  let camSaved = 0;
  function keepCam() {
    const now = performance.now();
    if (now - camSaved < 250) return;
    camSaved = now;
    try { sessionStorage.setItem(CAM_KEY, JSON.stringify({ p: camera.position.toArray().map((v) => +v.toFixed(3)), t: controls.target.toArray().map((v) => +v.toFixed(3)), cam: camMode, pick: camPick })); } catch { /* not kept */ }
  }
  function view(k: ViewKey) {
    const v = room.views[k]; camMode = null; lensBack();
    camera.position.set(...v.pos); controls.target.set(...v.at); controls.update();
  }

  // ---- the camera moves (director.ts): Tour, and five crews filming the show (Broadcast, Crane,
  // Steadicam, Drone, Band cam). The button starts and stops the one picked; grabbing the stage
  // (a drag, the wheel, a pinch) stops it, a click on a light doesn't. Kept in this tab with the camera.
  let camMode = $state<CamMode | null>(null);     // the one running (null: the camera is yours)
  let camPick = $state<CamMode>('tour');          // the one the button starts
  let camMenu = $state(false);
  const picked = $derived(CAM_MODES.find((m) => m.id === camPick) ?? CAM_MODES[0]);
  let crewMem = newMemory(), grabbing = false, grabFrom: { p: THREE.Vector3; t: THREE.Vector3 } | null = null;
  function startCam(m: CamMode) { camPick = m; camMode = m; crewMem = newMemory(); camMenu = false; camSaved = 0; if (controls) keepCam(); }
  function stopCam() { if (!camMode) return; camMode = null; lensBack(); camSaved = 0; keepCam(); }
  // the list of moves (opened from the keys: onto the one running, or the first)
  function openMoves(e: MouseEvent) {
    camMenu = !camMenu;
    if (camMenu && e.detail === 0) void tick().then(() => host?.querySelector<HTMLElement>('.cammoves button.on, .cammoves button')?.focus());
  }
  function closeMoves() { const inside = !!document.activeElement?.closest('.cammoves'); camMenu = false; if (inside) host?.querySelector<HTMLElement>('.caret')?.focus(); }
  // (a grab moves the camera from where the crew had it: more than a nudge, and the crew stops)
  function grabbed() {
    if (!camMode || !grabbing || !grabFrom) return;
    const d = Math.max(0.5, grabFrom.p.distanceTo(grabFrom.t));
    if (camera.position.distanceTo(grabFrom.p) > 0.035 * d || controls.target.distanceTo(grabFrom.t) > 0.035 * d) stopCam();
  }
  // a shot's lens is given against the normal one; resize() sets the normal one (a tall screen and a
  // take have their own), and it comes back when the crew stops
  let lensBase = 0, lensSet = 0;
  function lens(fov: number) {
    if (!lensBase || Math.abs(camera.fov - lensSet) > 1e-6) lensBase = camera.fov;
    const f = (2 * Math.atan((Math.tan((fov * RD) / 2) * Math.tan((lensBase * RD) / 2)) / Math.tan((LENS * RD) / 2))) / RD;
    if (Math.abs(f - camera.fov) > 1e-4) { camera.fov = f; camera.updateProjectionMatrix(); }
    lensSet = camera.fov;
  }
  function lensBack() {
    if (lensBase && camera && Math.abs(camera.fov - lensSet) < 1e-6 && camera.fov !== lensBase) { camera.fov = lensBase; camera.updateProjectionMatrix(); }
    lensBase = 0; lensSet = 0;
  }
  // who's where for the crews (the room's band or DJ, the lights as they're placed now), and the
  // song's parts while the timeline plays
  let cast: Cast | null = null, castFor: unknown = null, castRoom = '';
  function castNow(r: Room): Cast {
    if (!cast || castFor !== fixtures || castRoom !== r.id) { castFor = fixtures; castRoom = r.id; cast = castOf(r.id, fixtures.map((f) => ({ p: f.p, kind: f.look }))); }
    return cast;
  }
  let parts: Part[] = [], partsFor: unknown = null;
  function partNow(tl: Timeline | undefined): Part | null {
    if (!tl || !app.timeline.playing) return null;
    const src = tl.sections?.length ? tl.sections : tl.demo && !tl.audio ? 'demo' : null;
    if (src !== partsFor) { partsFor = src; parts = src === 'demo' ? sectionStarts() : src ? [...src].sort((a, b) => a.at - b.at) : []; }
    return partAt(parts, app.timeline.position);
  }
  // The screens' live picture, like a real show's: what the Broadcast crew films (its own crew, so
  // it cuts on the bar lines whatever your camera does), drawn small, a dozen or so times a second,
  // into one of two pictures while the screens show the other (never the one being drawn). Not at
  // the lowest drawing quality (the painted name instead), nor in a room without screens.
  let pointScale = 400;
  let feed: { cam: THREE.PerspectiveCamera; rt: THREE.WebGLRenderTarget[]; i: number; mem: ReturnType<typeof newMemory>; at: number; frames: number; shot: string } | null = null;
  function feedFrame(t: number, energy: number, frameDt = 1 / 60) {
    const scr = venue.screens;
    if (!scr) return;
    if (!liveScreens || load.level < 1) { if (scr.mat.map !== scr.painted) scr.mat.map = scr.painted; return; }
    if (!feed) {
      const mk = () => new THREE.WebGLRenderTarget(512, 288, { type: THREE.HalfFloatType });
      feed = { cam: new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 300), rt: [mk(), mk()], i: 0, mem: newMemory(), at: -1, frames: 0, shot: '' };
    }
    // (a dozen times a second; less on a computer that draws slowly: never more than every fourth frame)
    if (t - feed.at < Math.max(load.level >= 2 ? 1 / 15 : 1 / 8, 4 * frameDt) && t >= feed.at) return;
    feed.at = t;
    const r = roomOf(venue.room), s = direct('broadcast', r, { t, beat: app.engine.beatCount, energy, part: partNow(app.show.timeline) }, castNow(r), feed.mem), c = feed.cam;
    c.position.set(s.pos.x, s.pos.y, s.pos.z); c.up.set(0, 1, 0); c.lookAt(s.at.x, s.at.y, s.at.z);
    if (s.roll) c.rotateZ(s.roll * RD);
    if (c.fov !== s.fov) { c.fov = s.fov; c.updateProjectionMatrix(); }
    const target = feed.rt[feed.i];
    // (the confetti, sparks and fog the size they are in this small picture)
    particles.setScale(target.height * 0.9);
    renderer.setRenderTarget(target); renderer.render(scene, c); renderer.setRenderTarget(null);
    particles.setScale(pointScale);
    scr.mat.map = target.texture; feed.i ^= 1; feed.frames++; feed.shot = s.cam;
  }
  function feedFree() {
    if (venue?.screens) venue.screens.mat.map = venue.screens.painted;
    for (const rt of feed?.rt ?? []) rt.dispose();
    feed = null;
  }

  // this frame's shot: where the crew has the camera, what it looks at, its lens and roll
  function shoot(t: number, energy: number) {
    const r = roomOf(venue.room);
    const s = direct(camMode!, r, { t, beat: app.engine.beatCount, energy, part: partNow(app.show.timeline) }, castNow(r), crewMem);
    camera.position.set(s.pos.x, s.pos.y, s.pos.z); controls.target.set(s.at.x, s.at.y, s.at.z);
    camera.up.set(0, 1, 0); camera.lookAt(controls.target);
    if (s.roll) camera.rotateZ(s.roll * RD);
    lens(s.fov);
  }

  // Each view keeps its stage while another view is shown (App.svelte): only the stage on screen
  // has the world and draws. One in a hidden view hands the world on and stops (no frames, no
  // resizes, no listeners on the canvas); its own parts (controls, gizmo, glow passes) wait for it
  // to be shown again. Outside a view (no 'view-shown' context) a stage is always shown.
  const viewShown = getContext<(() => boolean) | undefined>('view-shown');
  const shownNow = $derived(viewShown ? viewShown() : true);
  let ro: ResizeObserver | undefined, gone = false;
  // active: shown (holding the world, or about to get it). holding: has it now; the effects that
  // change the world only run then, and run again when it comes back (the lights, the room, the
  // model may have changed while another view had it)
  let active = false, holding = $state(false), madeFor: THREE.WebGLRenderer | null = null, rigFor: RigFixture[] | null = null;
  // (shown: once its elements are there, see the markup)
  $effect(() => { const on = shownNow && !!host && !!cvHost; untrack(() => (on ? activate() : release())); });
  function activate() {
    if (active || gone) return;
    active = true; alive++;
    const k = takeKept();
    if (k || alive === 1) { start(k); return; }
    // another view's stage still has the world, on its way out: it comes in a moment
    const hand = (w: KeptWorld | null) => { clearTimeout(timer); if (active && !gone) start(w); else if (w) park(w); };
    const timer = setTimeout(() => { if (waiting === hand) waiting = null; if (active && !holding) start(null); }, 400);
    waiting = hand;
  }
  function start(k: KeptWorld | null) {
    if (gone || !active || holding) { if (k) park(k); return; }
    if (k) ({ renderer, canvas, scene, camera, wash, venue, rig, particles, builtRoom, shape } = k);
    else build();
    cvHost!.appendChild(canvas!);
    hemi = scene.getObjectByName('ambient:sky') as THREE.HemisphereLight | undefined;
    keyLight = scene.getObjectByName('ambient:key') as THREE.DirectionalLight | undefined;
    canvas!.setAttribute('aria-label', 'The stage in 3D: drag to look around, click a light to select it');
    canvas!.addEventListener('pointerdown', pdown); canvas!.addEventListener('pointerup', pup);
    // (this stage's own parts: made once, woken up again when it's shown again; a world built
    // anew, after the last one went back to the graphics chip, gets new ones)
    if (madeFor !== renderer) { if (madeFor) dropParts(); setup(); madeFor = renderer; } else wake();
    // (the lights now: a world handed on has the last view's; a late start missed the first round)
    untrack(() => { const list = fixtures, sig = sigOf(list); rigFor = list; if (sig !== shape) { shape = sig; rig.build(list); } else rig.place(list); });
    holding = true;
    ro = new ResizeObserver(resize); ro.observe(host!); resize();
    raf = requestAnimationFrame(frame);
  }
  // shown again: the camera where the last view left it, the sliders as they're kept now
  function wake() {
    controls.connect(); gizmo.connect();
    scene.add(proxy);
    if (custom) scene.add(custom);
    lensBase = 0; lensSet = 0;
    restoreCam();
    glow = Math.min(0.8, stored('luxdmx.seq.glow3', 0.3)); hazeAmt = stored('luxdmx.seq.haze', 0.45); ambient = Math.min(1, stored('luxdmx.seq.ambient2', 0.6));
    try { liveScreens = localStorage.getItem('luxdmx.seq.screensLive') !== '0'; } catch { /* as it was */ }
    composer.setPixelRatio(renderer.getPixelRatio());
    if (import.meta.env.DEV) (window as unknown as { __stage3d: unknown }).__stage3d = devHook;
  }
  // its view hidden: the world goes on to the view shown now (or waits for it)
  function release() {
    if (!active) return;
    active = false; alive--;
    if (!holding) return;                    // (still waiting for it: it's passed on when it comes)
    if (take) void stopRecording(true, true); // (a take running: saved as it is)
    camSaved = 0; keepCam();
    cancelAnimationFrame(raf); clearInterval(hiddenDraw); hiddenDraw = 0;
    ro?.disconnect(); ro = undefined;
    gizmo.detach(); controls.disconnect(); gizmo.disconnect();
    if (import.meta.env.DEV && (window as unknown as { __stage3d?: unknown }).__stage3d === devHook) delete (window as unknown as { __stage3d?: unknown }).__stage3d;
    feedFree();
    handOn(true);
  }
  // the world leaves this stage: on to the next one (3D still on), or back to the graphics chip
  function handOn(keep: boolean) {
    holding = false;
    canvas?.removeEventListener('pointerdown', pdown); canvas?.removeEventListener('pointerup', pup);
    scene.remove(proxy);
    if (custom) scene.remove(custom);
    const s = scene, r = renderer;
    const freeAll = () => { free(s); (s.environment as THREE.Texture | null)?.dispose(); r.dispose(); r.forceContextLoss(); };
    if (keep) { canvas?.remove(); canvas?.classList.remove('take'); park({ renderer, canvas: canvas!, scene, camera, wash, venue, rig, particles, builtRoom, shape, free: freeAll }); }
    else freeAll();
  }
  // this stage's own parts, for good
  function dropParts() {
    gizmo?.detach(); gizmo?.dispose(); controls?.dispose();
    if (gizmo) overlay.remove(gizmo.getHelper());
    composer?.dispose(); bloom?.dispose();
  }
  // the world, built (the first 3D stage, or the last one went back to the graphics chip)
  function build() {
    canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040507);
    scene.fog = new THREE.FogExp2(0x040507, 0.018);
    camera = new THREE.PerspectiveCamera(42, 1, 0.25, 400);
    // reflections for the metal and glass (a soft room, dimmed: it's a dark venue)
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.28;
    pm.dispose();
    const sky = new THREE.HemisphereLight(0x7f8ca6, 0x0b0b0e, 0.35); sky.name = 'ambient:sky'; scene.add(sky);
    const key = new THREE.DirectionalLight(0xa8b4cc, 0.35); key.name = 'ambient:key'; key.position.set(-8, 14, 18); scene.add(key);
    // three washes over the deck, coloured by what the lights do on each side (the band and the
    // backdrop take the show's colours; hundreds of real lights would be far too slow)
    wash = [-1, 0, 1].map((s) => { const l = new THREE.SpotLight(0xffffff, 0, 40, 0.55, 0.6, 1.2); l.position.set(s * 5, 11, 7); l.target.position.set(s * 3.5, DECK, -0.5); scene.add(l, l.target); return l; });
    venue = buildVenue({ room: room.id, band: app.show.settings.bandName }); builtRoom = room.id; showRoom(room);
    scene.add(venue.group);
    rig = new Rig(); scene.add(rig.group);
    particles = new Particles(); scene.add(particles.group);
  }
  // what each stage has of its own: the camera controls, the gizmo, the glow
  function setup() {
    controls = new OrbitControls(camera, canvas!);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.4; controls.maxDistance = 120;
    // (the wheel or a pinch zooms towards what you point at: right up to a light or the band)
    controls.zoomToCursor = true;
    gizmo = new TransformControls(camera, canvas!);
    gizmo.setSize(1.15);
    gizmo.addEventListener('dragging-changed', (e) => {
      const on = (e as unknown as { value: boolean }).value;
      controls.enabled = !on;
      // (one undo step for the whole drag: no saves half-way through it)
      if (on) { app.checkpoint(); app.holdUndo = true; grab(); } else { app.holdUndo = false; if (gizmo.mode === 'translate') snapAll(); dragStart = null; app.markDirty(0); }
    });
    gizmo.addEventListener('objectChange', () => moved());
    overlay.add(gizmo.getHelper());
    scene.add(proxy);
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(meter);
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), glow, 0.4, 0.62);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    restoreCam();
    controls.addEventListener('change', keepCam);
    controls.addEventListener('start', () => { grabbing = true; grabFrom = { p: camera.position.clone(), t: controls.target.clone() }; });
    controls.addEventListener('end', () => { grabbing = false; grabFrom = null; });
    controls.addEventListener('change', grabbed);
    // for the tests (dev only): what can't be read off the pixels (the shown stage's)
    if (import.meta.env.DEV) (window as unknown as { __stage3d: unknown }).__stage3d = devHook = {
      stats: () => ({ fixtures: fixtures.length, beams: rig.beamCount, particles: particles.count, fog: particles.fog }),
      // a band member's right hand (the band stands still without music)
      band: () => (venue as { band?: { handAt: (s: 'L' | 'R') => THREE.Vector3 }[] }).band?.[1]?.handAt('R').toArray() ?? null,
      // the screens: the live camera's picture on them (and how many it has drawn, its last shot)
      screens: () => venue.screens ? { live: venue.screens.mat.map !== venue.screens.painted, frames: feed?.frames ?? 0, shot: feed?.shot ?? '' } : null,
      screenOfPoint: (p: V3) => { const v = new THREE.Vector3(p.x, p.y, p.z).project(camera), r = canvas!.getBoundingClientRect(); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; },
      screenOf: (id: string) => { const f = fixtures.find((x) => x.id === id)!; const v = new THREE.Vector3(f.p.x, f.p.y, f.p.z).project(camera), r = canvas!.getBoundingClientRect(); return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }; },
      aimError: (p: V3) => Math.max(0, ...fixtures.filter((f) => f.kind === 'mover' && app.selected.includes(f.id)).map((f) => {
        // (from the head's pivot, where the beam really turns from)
        const v = app.stageNow[f.id], d = beamDir(typeof v?.pan === 'number' ? v.pan : 0.5, typeof v?.tilt === 'number' ? v.tilt : 0.5, f.rot, f.optics), o = pivotOf(f.p, f.rot), k = (p.y - o.y) / d.y;
        return Math.hypot(o.x + d.x * k - p.x, o.z + d.z * k - p.z);
      })),
      // the scene as the bloom gets it (linear light, before tone mapping), in full floats: NaN and
      // values past what the half-float buffers hold (65504) turn into black blocks after the blur
      hdr: (w = 480) => {
        const h = Math.max(1, Math.round(w / Math.max(0.1, camera.aspect)));
        const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
        renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
        // (the exposure meter's background read may have left a pixel buffer bound: then this read
        // would silently give zeros)
        const gl = renderer.getContext() as WebGL2RenderingContext;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const px = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); rt.dispose();
        let nan = 0, over = 0, max = 0;
        for (let i = 0; i < px.length; i++) { const v = px[i]; if (v !== v) nan++; else if (v > 65504) over++; else if (v > max) max = v; }
        return { nan, over, max, pixels: w * h };
      },
      internals: { THREE, renderer, scene, camera, controls, composer, bloom, view, meter, overlay },
      // the room and its people, what the band's banners show; the take running (its frame count)
      venue: () => ({ room: venue.room, crowd: venue.crowdCount, group: venue.group.uuid, band: venue.bandInfo() }),
      take: () => take,
      // a moving head where its motors are (degrees), and the haze the beams get now
      head: (id: string) => rig.headOf(id),
      haze: () => haze,
      ambient: () => ({ sky: hemi?.intensity, key: keyLight?.intensity, env: scene.environmentIntensity, walls: houseMats.length ? Math.max(...houseMats.map((m) => Math.max(m.color.r, m.color.g, m.color.b))) : null }),
    };
  }
  let devHook: unknown;
  // the camera where it was in this tab (a reload, back from 2D, or as the last view left it): not
  // back at the front
  function restoreCam() {
    let cam: { p: number[]; t: number[]; tour?: boolean; cam?: unknown; pick?: unknown } | null = null;
    try { cam = JSON.parse(sessionStorage.getItem(CAM_KEY) ?? 'null'); } catch { /* none */ }
    if (cam && cam.p?.length === 3 && cam.t?.length === 3 && [...cam.p, ...cam.t].every(Number.isFinite)) {
      camera.position.set(cam.p[0], cam.p[1], cam.p[2]); controls.target.set(cam.t[0], cam.t[1], cam.t[2]); controls.update();
      // (and the camera move that was running, and the one picked)
      camMode = isCamMode(cam.cam) ? cam.cam : cam.tour ? 'tour' : null;
      if (isCamMode(cam.pick)) camPick = cam.pick; else if (camMode) camPick = camMode;
    } else view('front');
  }
  // closing the 3D stage gives the graphics chip everything back (a fresh one opens next time)
  onDestroy(() => {
    gone = true;
    if (active) { active = false; alive--; }
    ro?.disconnect();
    if (take) void stopRecording(true, true);        // (a take running: saved as it is)
    if (holding && camera && controls) { camSaved = 0; keepCam(); }
    cancelAnimationFrame(raf);
    dropParts(); meter.dispose();
    if (import.meta.env.DEV && (window as unknown as { __stage3d?: unknown }).__stage3d === devHook) delete (window as unknown as { __stage3d?: unknown }).__stage3d;
    if (holding) { feedFree(); handOn(ui.stage3dNow); }
    // (3D switched off with the world parked by a view's stage that went away first: given back)
    else if (!ui.stage3dNow && alive === 0 && kept) { kept.free(); kept = null; clearTimeout(keptTimer); }
  });

  // what's under o goes back to the graphics chip: geometry, materials, their pictures
  function free(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          // (cached canvas textures too: three uploads them again for the next stage)
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      }
    });
  }

  const sizeNow = new THREE.Vector2();
  function resize() {
    if (!host || !renderer || !holding) return;
    // (a take keeps its own size whatever the window does meanwhile: see record())
    const w = takeSz?.w ?? host.clientWidth, h = takeSz?.h ?? host.clientHeight;
    // (hidden, or folded away: it measures nothing; the canvas keeps its size for when it's back)
    if (w < 2 || h < 2) return;
    // (the same size again, e.g. the observer's first call: the canvas isn't made anew)
    const pr = renderer.getPixelRatio();
    renderer.getSize(sizeNow);
    if (sizeNow.x !== w || sizeNow.y !== h || canvas!.width !== Math.floor(w * pr) || canvas!.height !== Math.floor(h * pr)) renderer.setSize(w, h, false);
    composer.setSize(w, h); camera.aspect = w / Math.max(1, h);
    // (a tall screen sees as much of the stage across as a wide one: the views are made for 16:9)
    // (only a really tall one: a panel a bit narrower than wide keeps the normal lens and its zoom)
    camera.fov = takeFov ?? (camera.aspect < 0.85 ? Math.min(62, 42 * Math.pow(0.85 / camera.aspect, 0.5)) : 42);
    camera.updateProjectionMatrix();
    pointScale = h * 0.9 * renderer.getPixelRatio();
    particles.setScale(pointScale);     // (point sizes are in device pixels)
  }

  // Rebuilt when lights come or go (or change type); only moved when they move (dragging a dozen
  // lights mustn't rebuild every mesh 60 times a second)
  let shape: string | null = null;      // (null: never built, also for no lights at all)
  // (a take of another shape: the canvas letterboxed, see the styles)
  $effect(() => { canvas?.classList.toggle('take', !!take); });
  const sigOf = (list: RigFixture[]) => list.map((f) => `${f.id}:${f.kind}:${f.cells}:${f.sfx ?? ''}:${f.look}`).join();
  $effect(() => {
    // (only the stage holding the world; shown again, it catches up with what changed meanwhile)
    if (!holding) return;
    const list = fixtures, sig = sigOf(list);
    if (!rig) return;
    untrack(() => { if (list === rigFor) return; rigFor = list; if (sig !== shape) { shape = sig; rig.build(list); } else rig.place(list); });
  });
  // The gizmo sits at the middle of the selection: Move moves them all, Turn turns each one in its
  // place by the same amount (ten PARs tipped 10° more), one at a time it's that light's own.
  $effect(() => {
    // (only while this stage has the world; on it again when it's shown again)
    if (!holding) return;
    const sel = app.selected, m = mode;
    // (and wherever they are now: after Hang, Reset or Undo it sits on them, not where they were)
    const where = fixtures.filter((x) => sel.includes(x.id)).map((f) => `${f.p.x},${f.p.y},${f.p.z},${f.rot.yaw},${f.rot.pitch},${f.rot.roll}`).join();
    untrack(() => {
      void where;
      if (!gizmo || dragStart) return;
      const fs = (m === 'move' || m === 'turn') && !readonly ? fixtures.filter((x) => sel.includes(x.id)) : [];
      if (!fs.length) { gizmo.detach(); return; }
      const c = fs.reduce((a, f) => a.add(new THREE.Vector3(f.p.x, f.p.y, f.p.z)), new THREE.Vector3()).divideScalar(fs.length);
      proxy.position.copy(c);
      if (fs.length === 1) proxy.quaternion.copy(quatOf(fs[0].rot)); else proxy.quaternion.identity();
      gizmo.setMode(m === 'move' ? 'translate' : 'rotate');
      gizmo.setSpace(fs.length === 1 ? 'local' : 'world');
      gizmo.setTranslationSnap(0.05); gizmo.setRotationSnap(Math.PI / 72);
      gizmo.attach(proxy);
    });
  });
  const RD = Math.PI / 180;
  const quatOf = (r: Rot) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r.pitch * RD, r.yaw * RD, r.roll * RD, 'YXZ'));
  const rotOf = (q: THREE.Quaternion): Rot => { const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); return { yaw: Math.round(e.y / RD * 10) / 10, pitch: Math.round(e.x / RD * 10) / 10, roll: Math.round(e.z / RD * 10) / 10 }; };
  const r1 = (v: number) => Math.round(v * 100) / 100 + 0;      // (+ 0: no -0 in the show file)
  let dragStart: { p: THREE.Vector3; q: THREE.Quaternion; items: { id: string; p: V3; q: THREE.Quaternion }[] } | null = null;
  function grab() {
    dragStart = { p: proxy.position.clone(), q: proxy.quaternion.clone(), items: fixtures.filter((f) => app.selected.includes(f.id)).map((f) => ({ id: f.id, p: { ...f.p }, q: quatOf(f.rot) })) };
  }
  // the gizmo moved or turned: every light in the selection follows (and its plan position too)
  function moved() {
    if (!dragStart) return;
    const d = proxy.position.clone().sub(dragStart.p), qd = proxy.quaternion.clone().multiply(dragStart.q.clone().invert());
    for (const it of dragStart.items) {
      const f = app.show.fixtures.find((x) => x.id === it.id);
      if (!f) continue;
      if (gizmo.mode === 'translate') { f.p3 = { x: r1(it.p.x + d.x), y: r1(Math.max(0, it.p.y + d.y)), z: r1(it.p.z + d.z) }; const pl = worldToPlan(f.p3.x, f.p3.z, room); f.x = pl.x; f.y = pl.y; }
      else { f.p3 ??= { ...it.p }; f.rot = rotOf(qd.clone().multiply(it.q)); }
    }
  }
  // let go near a truss: they hang on it; near the deck: they stand on it
  function snapAll() {
    for (const id of app.selected) {
      const f = app.show.fixtures.find((x) => x.id === id);
      if (!f?.p3) continue;
      const t = nearestTruss(f.p3.z, room);
      if (Math.abs(f.p3.y - (t.y - TRUSS_HANG)) < 0.9 && Math.abs(f.p3.z - t.z) < 0.9) {
        f.p3 = { ...f.p3, y: t.y - TRUSS_HANG, z: t.z };
        if (app.kinds[f.id] === 'mover' && f.rot && Math.abs(f.rot.roll) < 90) f.rot = { ...f.rot, roll: 180 };
      } else {
        const deck = onDeck(f.p3.x, f.p3.z, room) && Math.abs(f.p3.y - DECK) < 0.6;
        if (!deck && f.p3.y >= 0.6) continue;
        f.p3 = { ...f.p3, y: deck ? DECK : 0 };
        // (a head off the truss stands on its base: not upside down with its head in the floor)
        if (app.kinds[f.id] === 'mover' && f.rot && Math.abs(f.rot.roll) >= 90) f.rot = { ...f.rot, roll: 0 };
      }
    }
  }

  // ---- the selection's numbers: one value for all of them, or "mixed"; − / + moves each one
  type Field = 'x' | 'y' | 'z' | 'yaw' | 'pitch' | 'roll';
  const FIELDS: [Field, string, number][] = [['x', 'X m', 0.1], ['y', 'Height m', 0.1], ['z', 'Z m', 0.1], ['yaw', 'Turn °', 5], ['pitch', 'Tip °', 5], ['roll', 'Roll °', 5]];
  const selFx = $derived(fixtures.filter((f) => app.selected.includes(f.id)));
  const valOf = (f: RigFixture, k: Field) => (k === 'x' || k === 'y' || k === 'z' ? f.p[k] : f.rot[k]);
  function common(k: Field) {
    if (!selFx.length) return '';
    const v = valOf(selFx[0], k);
    return selFx.every((f) => Math.abs(valOf(f, k) - v) < 0.005) ? String(k === 'x' || k === 'y' || k === 'z' ? r1(v) : Math.round(v * 10) / 10) : '';
  }
  function setEach(k: Field, fn: (v: number) => number) {
    app.checkpoint();
    for (const r of selFx) {
      const f = app.show.fixtures.find((x) => x.id === r.id);
      if (!f) continue;
      const p = { ...r.p }, rot = { ...r.rot };
      if (k === 'x' || k === 'y' || k === 'z') p[k] = r1(k === 'y' ? Math.max(0, fn(p[k])) : fn(p[k])); else rot[k] = Math.round(fn(rot[k]) * 10) / 10;
      f.p3 = p; f.rot = rot;
      const pl = worldToPlan(p.x, p.z, room); f.x = pl.x; f.y = pl.y;
    }
    app.markDirty(0);
  }
  // in a row: spread evenly between the outermost two (across the stage), all at the same height
  function spread() {
    if (selFx.length < 3) return;
    const s = [...selFx].sort((a, b) => a.p.x - b.p.x), a = s[0].p, b = s[s.length - 1].p;
    app.checkpoint();
    s.forEach((r, i) => { const f = app.show.fixtures.find((x) => x.id === r.id); if (!f) return; const t = i / (s.length - 1); f.p3 = { x: r1(a.x + (b.x - a.x) * t), y: r1(a.y + (b.y - a.y) * t), z: r1(a.z + (b.z - a.z) * t) }; f.rot ??= { ...r.rot }; const pl = worldToPlan(f.p3.x, f.p3.z, room); f.x = pl.x; f.y = pl.y; });
    app.markDirty(0);
  }
  // the selection, mounted a way (keeps where it is across the stage)
  function mount(how: 'hang' | 'deck' | 'floor') {
    app.checkpoint();
    for (const id of app.selected) {
      const f = app.show.fixtures.find((x) => x.id === id), r = fixtures.find((x) => x.id === id);
      if (!f || !r) continue;
      const t = nearestTruss(r.p.z, room), mover = r.kind === 'mover', machine = !!(r.fog || r.sfx);
      // machines stand level, their nozzle towards the band (hung: on the truss, still level)
      if (machine) {
        f.p3 = how === 'hang' ? { x: r.p.x, y: t.y + 0.2, z: t.z } : how === 'deck' ? { x: r.p.x, y: DECK, z: Math.min(D / 2 - 0.3, r.p.z) } : { x: r.p.x, y: 0, z: D / 2 + 0.9 };
        f.rot = { yaw: faceBand(f.p3), pitch: 0, roll: 0 };
        continue;
      }
      const rot: Rot = how === 'hang' ? (mover ? { yaw: 0, pitch: 0, roll: 180 } : { ...r.rot, roll: 0, pitch: Math.max(110, r.rot.pitch) }) : mover ? { yaw: 0, pitch: 0, roll: 0 } : { yaw: 0, pitch: how === 'deck' ? 30 : 40, roll: 0 };
      f.p3 = how === 'hang' ? { x: r.p.x, y: t.y - TRUSS_HANG, z: t.z } : how === 'deck' ? { x: r.p.x, y: DECK, z: Math.min(D / 2 - 0.3, r.p.z) } : { x: r.p.x, y: 0, z: D / 2 + 0.9 };
      f.rot = rot;
    }
    app.markDirty(0);
  }
  function resetPlace() {
    app.checkpoint();
    for (const id of app.selected) { const f = app.show.fixtures.find((x) => x.id === id); if (f) { delete f.p3; delete f.rot; } }
    app.markDirty(0);
  }

  // ---- clicks: select a light, or aim the selected heads at a spot
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  function at(e: PointerEvent) { const r = shown(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function pdown(e: PointerEvent) { down = { x: e.clientX, y: e.clientY }; }
  function pup(e: PointerEvent) {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0 || gizmo.dragging) { down = null; return; }
    down = null;
    at(e);
    if (mode === 'aim' && !readonly) { aim(); return; }
    if (mode === 'calib' && !readonly) { calib(); return; }
    if (readonly) return;                  // (a Live page or the timeline's picture: looking, not picking lights)
    const id = rig.pick(ray);
    if (id) app.select(id, e.shiftKey || e.ctrlKey || e.metaKey);
    else if (!e.shiftKey && mode === 'select') app.selectNone();
  }
  // where the click meets the deck (or the floor in front of it)
  function spot(): V3 | undefined {
    const hit = (y: number) => { const t = (y - ray.ray.origin.y) / ray.ray.direction.y; return t > 0 ? ray.ray.origin.clone().addScaledVector(ray.ray.direction, t) : undefined; };
    let p = hit(DECK);
    if (!p || !onDeck(p.x, p.z, room)) p = hit(0);
    return p ? { x: p.x, y: p.y, z: p.z } : undefined;
  }
  // Calibrate: the real head points at a spot (moved there with the pan/tilt pad); a click on that
  // spot here works out its offsets, so the 3D stage and Aim agree with the room from then on
  function calib() {
    const p = spot(), f = fixtures.find((x) => x.kind === 'mover' && x.id === app.selected[0]), fx = app.show.fixtures.find((x) => x.id === f?.id);
    if (!p || !f || !fx || app.selected.length !== 1) { ui.toast('Select one moving head first'); return; }
    const v = app.stageNow[f.id];
    const c = calibrate(f.p, f.rot, p, typeof v?.pan === 'number' ? v.pan : 0.5, typeof v?.tilt === 'number' ? v.tilt : 0.5, f.optics);
    app.checkpoint();
    fx.panOffset = Math.round(c.panOffset); fx.tiltOffset = Math.round(c.tiltOffset);
    if (!fx.panOffset) delete fx.panOffset; if (!fx.tiltOffset) delete fx.tiltOffset;
    app.markDirty(0);
    mode = 'select';
    ui.toast(`${fx.name} calibrated: pan offset ${Math.round(c.panOffset)}°, tilt ${Math.round(c.tiltOffset)}°. Aim points it right now.`, 5000);
  }
  function aim() {
    const p = spot();
    if (!p) return;
    // moving heads by pan and tilt (the programmer, Record keeps it); fixed lights are turned to
    // face it (where they hang: the show keeps it)
    const sel = fixtures.filter((f) => app.selected.includes(f.id) && !f.sfx && !f.fog);
    if (!sel.length) { ui.toast('Select lights first, then click where they should point'); return; }
    const movers = sel.filter((f) => f.kind === 'mover'), fixed = sel.filter((f) => f.kind !== 'mover');
    let missed = 0;
    for (const f of movers) {
      const now = app.stageNow[f.id];
      const a = aimAt(f.p, f.rot, p as V3, f.optics, { pan: typeof now?.pan === 'number' ? now.pan : 0.5, tilt: typeof now?.tilt === 'number' ? now.tilt : 0.5 });
      if (a) app.programmer[f.id] = { ...app.programmer[f.id], pan: a.pan, tilt: a.tilt }; else missed++;
    }
    if (fixed.length) {
      app.checkpoint();
      for (const r of fixed) { const f = app.show.fixtures.find((x) => x.id === r.id); if (f) { f.p3 = { ...r.p }; f.rot = aimRot(r.p, p); } }
      app.markDirty(0);
    }
    if (movers.length) app.lightUpIfDark(movers.map((f) => f.id));
    const said = [movers.length ? `${movers.length - missed} moving head${movers.length - missed === 1 ? '' : 's'} pointed there (Record keeps it)` : '', fixed.length ? `${fixed.length} light${fixed.length === 1 ? '' : 's'} turned to face it` : '', missed ? `${missed} can't reach it` : ''].filter(Boolean).join('; ');
    ui.toast(said, 4000);
  }

  // ---- your own venue: a .glb (or a .gltf with everything inside) from a file, kept in this
  // browser; its size, height and turn by hand; the built-in stage can go
  let venuePanel = $state(false);
  let modelFile = $state<HTMLInputElement>();
  let custom: THREE.Object3D | null = null, customFor = '';
  const vm = $derived(app.show.settings.stage3d?.model);
  async function loadModel(f: File) {
    try {
      const buf = await f.arrayBuffer();
      const g = await new GLTFLoader().parseAsync(buf, '');
      // fitted: standing on the floor, its middle at the stage's, metres (a model in millimetres
      // or centimetres comes in far too big: scaled down)
      const b = new THREE.Box3().setFromObject(g.scene), size = b.getSize(new THREE.Vector3()), big = Math.max(size.x, size.y, size.z);
      const scale = big > 2000 ? 0.001 : big > 300 ? 0.01 : 1;
      const key = `${app.showId}:${f.name}`;
      try { await putModel(key, f); } catch { /* shown now; another time it asks again */ }
      app.checkpoint();
      app.show.settings.stage3d = { ...app.show.settings.stage3d, model: { name: f.name, store: key, scale, x: r1(-(b.min.x + b.max.x) / 2 * scale), y: r1(-b.min.y * scale), z: r1(-(b.min.z + b.max.z) / 2 * scale), yaw: 0 } };
      app.markDirty(0);
      ui.toast(`"${f.name}" is in the 3D stage${scale !== 1 ? ` (scaled ${scale}: it looked like ${scale === 0.001 ? 'millimetres' : 'centimetres'})` : ''}`, 5000);
    } catch (e) { ui.toast(`That model doesn't open here (${(e as Error).message.slice(0, 80)}). A .glb works best.`, 6000); }
  }
  function setModel(k: keyof Omit<VenueModel, 'name' | 'store'>, v: number) {
    const m = app.show.settings.stage3d?.model;
    if (!m || !Number.isFinite(v)) return;
    app.checkpoint(); m[k] = v; app.markDirty(0);
  }
  function removeModel() { app.checkpoint(); if (app.show.settings.stage3d) delete app.show.settings.stage3d.model; app.markDirty(0); }
  function setHideVenue(h: boolean) { app.checkpoint(); app.show.settings.stage3d = { ...app.show.settings.stage3d, hideVenue: h || undefined }; app.markDirty(0); }
  // the built-in room: the big stage, or a small club / pub (kept with the show)
  function setRoom(id: 'hall' | 'pub' | 'club' | 'party' | 'truss') {
    if (room.id === id) return;
    app.checkpoint(); app.show.settings.stage3d = { ...app.show.settings.stage3d, room: id === 'hall' ? undefined : id }; app.markDirty(0);
  }
  // the band's name on the banners, screens and kick drum (kept with the show; empty: their
  // picture). While typing the banners follow a moment later; Enter or leaving the field keeps it.
  let bandTimer = 0;
  function previewBand(v: string) { clearTimeout(bandTimer); bandTimer = window.setTimeout(() => venue?.setBand(v.slice(0, 60)), 250); }
  function setBandName(v: string) {
    clearTimeout(bandTimer);
    const name = v.trim().slice(0, 60);
    if ((app.show.settings.bandName ?? '') === name) { venue?.setBand(name); return; }
    app.checkpoint();
    if (name) app.show.settings.bandName = name; else delete app.show.settings.bandName;
    app.markDirty(0);
  }
  // a show with another room: that room is built (and the camera goes to its front view); another
  // name: only the banners are painted again
  let builtRoom = '';
  $effect(() => {
    const r = room;
    if (!holding) return;
    untrack(() => {
      if (!scene || !venue || r.id === builtRoom) return;
      scene.remove(venue.group); free(venue.group);
      venue = buildVenue({ room: r.id, band: app.show.settings.bandName });
      venue.group.visible = !app.show.settings.stage3d?.hideVenue;
      scene.add(venue.group); builtRoom = r.id; showRoom(r);
      view('front');
    });
  });
  $effect(() => { const n = app.show.settings.bandName ?? ''; if (holding) untrack(() => venue?.setBand(n)); });
  // the model in the scene: loaded once per file, placed every time the numbers change
  $effect(() => {
    const m = vm, hide = !!app.show.settings.stage3d?.hideVenue;
    if (!holding) return;
    untrack(() => {
      if (venue) venue.group.visible = !hide;
      if (!scene) return;
      if (!m) { if (custom) { scene.remove(custom); custom = null; customFor = ''; } return; }
      const placeIt = () => { if (!custom) return; custom.scale.setScalar(m.scale); custom.position.set(m.x, m.y, m.z); custom.rotation.y = (m.yaw * Math.PI) / 180; };
      if (customFor === m.store) { placeIt(); return; }
      customFor = m.store;
      void getModel(m.store).then(async (blob) => {
        if (!blob) { ui.toast(`"${m.name}" isn't in this browser: load it again (3D, Venue)`, 5000); return; }
        const g = await new GLTFLoader().parseAsync(await blob.arrayBuffer(), '');
        if (customFor !== m.store) return;
        if (custom) scene.remove(custom);
        custom = g.scene; if (holding) scene.add(custom); placeIt();      // (its view hidden meanwhile: added when it's shown)
      }).catch(() => ui.toast(`"${m.name}" didn't open`));
    });
  });

  // ---- every frame
  const sideCol = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  // ---- quality (perf/load.svelte.ts): the DMX output comes first; drawing gives way. High: full
  // sharpness, glow, every frame; Medium: a little less sharp on a high-density screen, 30 frames a
  // second; Low: no glow, 20 a second. Never fewer pixels than the screen has: a blurred stage was
  // the first thing anyone noticed, frames and glow are what can go. A take keeps every frame.
  const RATIO = [1, 1.5, 2], EVERY = [1000 / 21, 1000 / 31, 0];
  let drawnAt = 0;
  function quality() {
    if (taking) return;
    const want = Math.min(RATIO[load.level], window.devicePixelRatio || 1);
    if (Math.abs(want - renderer.getPixelRatio()) < 0.01) return;
    renderer.setPixelRatio(want); composer.setPixelRatio(want); resize();
  }
  // the graphics card's time per frame, where the browser can measure it (a timer query)
  let gpuExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined, gpuQ: WebGLQuery[] = [];
  function gpuBegin(): WebGLQuery | null {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (gpuExt === undefined) gpuExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!gpuExt || gpuQ.length > 2) return null;
    const q = gl.createQuery();
    if (q) gl.beginQuery(gpuExt.TIME_ELAPSED_EXT, q);
    return q;
  }
  function gpuEnd(q: WebGLQuery | null) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (q && gpuExt) { gl.endQuery(gpuExt.TIME_ELAPSED_EXT); gpuQ.push(q); }
    while (gpuQ.length && gl.getQueryParameter(gpuQ[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = gpuQ.shift()!;
      if (gpuExt && !gl.getParameter(gpuExt.GPU_DISJOINT_EXT)) load.gpuTime(gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(done);
    }
  }
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    // (a take goes on drawing: in a hidden tab a timer calls this, see hiddenTake())
    if ((document.hidden && !taking) || !host?.isConnected) return;
    // (folded away to nothing, e.g. the timeline's picture on a phone: nothing to draw)
    if (!canvas || (!taking && (canvas.clientWidth < 2 || canvas.clientHeight < 2))) { last = now; return; }
    // (fewer frames a second at a lower quality: the time goes to the DMX output)
    if (!taking && now - drawnAt < EVERY[load.level]) return;
    drawnAt = now;
    const work0 = performance.now();
    quality();
    const real = Math.min(0.5, (now - last) / 1000), dt = Math.min(0.1, real); last = now;
    const t = now / 1000;
    const sel = new Set(app.selected);
    // haze: a base so beams show, more while a fog or haze machine runs
    let smoke = 0;
    const machines = [];
    for (const f of fixtures) {
      const v = app.stageNow[f.id];
      if (f.fog) {
        const s = Math.max(typeof v?.fog === 'number' ? v.fog : 0, typeof v?.haze === 'number' ? v.haze : 0); smoke = Math.max(smoke, s);
        // out of its nozzle (the machine's front), along the floor; a hazer's fine haze rises
        const fr = new THREE.Vector3(0, 0, 1).applyQuaternion(quatOf(f.rot));
        machines.push({ e: { id: `${f.id}:fog`, kind: 'fog' as const, x: f.p.x, y: f.p.y, z: f.p.z, dir: { x: fr.x, y: fr.y, z: fr.z }, haze: f.hazer }, v: s });
      }
      if (f.sfx) machines.push({ e: { id: `${f.id}:${f.sfx}`, kind: f.sfx, x: f.p.x, y: f.p.y, z: f.p.z }, v: typeof (v as Record<string, unknown> | undefined)?.[f.sfx] === 'number' ? (v as Record<string, number>)[f.sfx] : 0 });
    }
    // (the room fills with fog while the machines run and clears over minutes: the beams show more
    // everywhere; the Haze slider stays in charge, the fog raises it by up to half again. The slider
    // acts at once, the machines' smoke comes in slowly; up to 1.5, so the whole slider counts in a
    // foggy room too, not just its bottom half)
    const room = Math.min(1.5, particles.fogginess);
    smokeIn += (smoke - smokeIn) * Math.min(1, dt * 0.8);
    haze = Math.min(1.5, hazeAmt * (0.9 + 0.5 * room) + 0.08 * Math.max(room, 0.5 * smokeIn));
    (scene.fog as THREE.FogExp2).density = 0.005 + 0.016 * haze;
    rig.update(app.stageNow, t, haze, sel);
    particles.light(rig.lit);
    // (the machines' output follows the clock, not the frame rate: a slow computer gets the same fog
    // and confetti, in steps of at most 0.1 s)
    for (let left = real; left > 1e-4; left -= 0.1) particles.step(Math.min(0.1, left), machines);
    // the washes take the colour of the lights on their third of the stage
    let energy = 0;
    sideCol.forEach((c) => c.setRGB(0, 0, 0));
    const lv = [0, 0, 0];
    for (const l of rig.lit) { const s = l.p.x < -W / 6 ? 0 : l.p.x > W / 6 ? 2 : 1; sideCol[s].r += l.c.r * l.level; sideCol[s].g += l.c.g * l.level; sideCol[s].b += l.c.b * l.level; lv[s] += l.level; energy += l.level; }
    wash.forEach((w, i) => { const n = Math.max(1e-3, lv[i]); w.color.setRGB(sideCol[i].r / n, sideCol[i].g / n, sideCol[i].b / n); w.intensity = Math.min(1, lv[i] / 4) * 140; });
    energy = Math.min(1, energy / Math.max(4, fixtures.length * 0.4));
    const all = sideCol[0].clone().add(sideCol[1]).add(sideCol[2]).multiplyScalar(1 / Math.max(1e-3, lv[0] + lv[1] + lv[2]));
    // (music: the song playing on the timeline, inside the song, or the microphone hearing a beat;
    // without it the band and the DJ stand still)
    const tl = app.timeline, music = (tl.playing && tl.position >= 0 && tl.position < tl.duration) || (app.music.on && app.music.confidence > 0.3);
    venue.animate(t, app.engine.beatCount, energy, lv[0] + lv[1] + lv[2] > 0.01 ? all : new THREE.Color(0x6a40ff), music);
    particles.ambient(all.r * energy, all.g * energy, all.b * energy);
    // a foggy room glows in the colour of the light in it
    const tint = 0.045 * Math.min(1, room) * Math.min(1, energy * 2.5);
    fogCol.copy(DARK).add(sideCol[0].clone().add(sideCol[1]).add(sideCol[2]).multiplyScalar(tint / Math.max(1e-3, lv[0] + lv[1] + lv[2])));
    (scene.fog as THREE.FogExp2).color.copy(fogCol); (scene.background as THREE.Color).copy(fogCol);
    // the camera: a crew moving it (held still while you grab the stage), or yours
    // (the controls glide out a drag frame by frame: as many steps as 60 frames a second would take,
    // so on a slow computer the camera stops as soon as on a fast one, not seconds later)
    if (!camMode) { const steps = Math.max(1, Math.min(30, Math.round(real * 60))); for (let i = 0; i < steps; i++) controls.update(); }
    else if (!grabbing) shoot(t, energy);
    feedFrame(t, energy, real);
    // the near plane follows the zoom: close up nothing in front of the lens is cut off, far out the
    // depth stays precise (no flicker between surfaces)
    const nearAt = Math.min(0.25, Math.max(0.03, camera.position.distanceTo(controls.target) * 0.08));
    if (Math.abs(camera.near - nearAt) > 0.004) { camera.near = nearAt; camera.updateProjectionMatrix(); }
    bloom.strength = glow;
    // the room's own light, by the Ambient slider (1.25 times what it always had at the top)
    const amb = ambLight(ambient);
    if (hemi) hemi.intensity = 0.35 * amb;
    // the house's unlit walls and ceilings (gear.ts `house`): near black at the default, black at 0
    if (houseOf !== venue.group) { houseOf = venue.group; houseMats = []; venue.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m?.userData?.house !== undefined && !houseMats.includes(m)) houseMats.push(m); }); }
    // (at the top of the slider as the room always looked; the default near black)
    const hk = Math.pow(amb / 1.25, 3);
    for (const m of houseMats) m.color.setHex(m.userData.house).multiplyScalar(hk);
    if (keyLight) keyLight.intensity = 0.35 * amb;
    scene.environmentIntensity = 0.28 * amb;
    // exposure like a camera's: down when looking into the lights, up a little for a dark look (less
    // with less room light: lifting a dark room is what makes it look lit)
    renderer.toneMappingExposure += (meter.target(EXPOSURE_KEY, 0.12, 1.05 + 0.35 * Math.min(1, amb)) - renderer.toneMappingExposure) * Math.min(1, dt * 1.2);
    const q = gpuBegin();
    if (glow > 0.02 && (load.level > 0 || taking)) composer.render(); else renderer.render(scene, camera);
    // the gizmo on top, after the glow (inside it, a bright look washed it out)
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(overlay, camera); renderer.autoClear = true;
    gpuEnd(q);
    if (taking) take?.frame(now);          // (a take running: this frame into the video, see recorder.ts)
    load.did(performance.now() - work0);
  }

  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await host!.requestFullscreen(); } catch { ui.toast('This browser won\'t go full screen here'); }
  }
  $effect(() => { try { localStorage.setItem('luxdmx.seq.glow3', String(glow)); localStorage.setItem('luxdmx.seq.haze', String(hazeAmt)); localStorage.setItem('luxdmx.seq.ambient2', String(ambient)); } catch { /* not remembered */ } });
  const pickedName = $derived(app.selected.length === 1 ? app.show.fixtures.find((f) => f.id === app.selected[0])?.name : app.selected.length ? `${app.selected.length} lights` : '');

  // ---- a video of the stage with its sound (the timeline's song or the demo beat): Record starts a
  // take, the REC chip counts, Stop saves the file. A 1080p take draws at 1920 x 1080 while it
  // runs (letterboxed here) and goes back to the window's size after; a 9:16 one (phones: Reels,
  // Stories) at 1080 x 1920, with a lens wide enough across for the band and the lights.
  const VIDEO_KEY = 'luxdmx.seq.video3d';
  let videoSize = $state<VideoSize>((() => { try { const v = localStorage.getItem(VIDEO_KEY); return VIDEO_SIZES.find((s) => s === v) ?? '1080p'; } catch { return '1080p'; } })());
  $effect(() => { try { localStorage.setItem(VIDEO_KEY, videoSize); } catch { /* not remembered */ } });
  const recordable = canRecord();
  // (a browser that only makes WebM, like Firefox: Instagram and many phones want MP4)
  const webmOnly = recordable && (() => { try { return pickFormat((t) => MediaRecorder.isTypeSupported(t))?.ext === 'webm'; } catch { return false; } })();
  const WEBM_NOTE = 'This browser records WebM. Instagram and many phones want MP4: Chrome, Edge and Safari record MP4 (or convert the file).';
  const SIZE_SAYS: Record<VideoSize, string> = { '1080p': '1920 x 1080', vertical: '1080 x 1920, for phones', shown: 'as shown' };
  let take = $state.raw<Take | null>(null);
  let taking = false;                     // (the same for the frame loop: no reactive read every frame)
  let takeSz: { w: number; h: number } | null = null, takePr = 1, takeShow = '', takeKind: VideoSize = '1080p';
  let takeFov: number | null = null;      // (a tall take's own lens, see fitTall)
  let recSecs = $state(0), recTimer = 0, hiddenDraw = 0;
  function record() {
    if (take || !renderer || !canvas || !host) return;
    if (!recordable) { ui.toast('This browser can\'t record video here. Chrome, Edge, Firefox and Safari can.', 6000); return; }
    more = false;
    const audio = app.timeline.audioStream();
    const format = pickFormat((t) => MediaRecorder.isTypeSupported(t), !!audio);
    if (!format) { ui.toast('This browser can\'t record video here. Chrome, Edge, Firefox and Safari can.', 6000); return; }
    // the take's own size: drawn at it (pixel ratio 1) until Stop
    takePr = renderer.getPixelRatio(); takeKind = videoSize;
    takeSz = takeSize(videoSize, host.clientWidth, host.clientHeight, takePr);
    takeFov = fitTall(takeSz.w, takeSz.h);
    renderer.setPixelRatio(1); composer.setPixelRatio(1); resize();
    try {
      take = new Take({ canvas, audio, format, videoBits: videoBits(takeSz.w, takeSz.h),
        onError: (m) => { ui.toast(`The recording stopped (${m}). What it had is saved.`, 6000); void stopRecording(); } });
    } catch (e) { sizeBack(); ui.toast(`This browser won't record the stage (${(e as Error).message.slice(0, 80)})`, 6000); return; }
    taking = true; recSecs = 0; takeShow = app.show.meta.name;
    // (the layout holds still while it records: a window crossing a size doesn't swap the stage out)
    ui.recording = true;
    recTimer = window.setInterval(() => { recSecs = Math.floor(take?.seconds ?? 0); }, 250);
  }
  // closing: the 3D stage is going away (no size to go back to); save: the file, or only stop
  async function stopRecording(save = true, closing = false) {
    const t = take;
    if (!t) return;
    take = null; taking = false; ui.recording = false;
    clearInterval(recTimer); clearInterval(hiddenDraw); hiddenDraw = 0;
    const file = t.stop(), secs = t.seconds;
    // (choppy: fewer frames drawn a second than a video needs, said with what to try)
    const choppy = secs >= 2 ? stutterNote(t.drawnFps, takeKind) : undefined;
    if (!closing) sizeBack();
    if (!save) return;
    const blob = await file;
    if (!blob.size) { ui.toast('Nothing was recorded (too short, or the browser gave nothing back)', 5000); return; }
    const name = videoName(takeShow, t.startedAt, extOf(blob.type || t.mime));
    saveVideo(blob, name);
    ui.toast(`Saved "${name}" (${clock(secs)}, ${megabytes(blob.size)} MB)${choppy ? `. ${choppy}` : ''}`, choppy ? 10000 : 5000);
  }
  // A tall take's lens: wide enough across for the band (where it stands in this room) and the lights,
  // seen from where the camera is now; null for a wide take (the views are made for those)
  function fitTall(w: number, h: number): number | null {
    if (h <= w) return null;
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse, pts: THREE.Vector3[] = [], b = room.band, a = w / h;
    for (const x of [-b.x, b.x]) for (const y of [DECK, DECK + 2.3]) for (const z of [b.z0, b.z1]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    for (const f of fixtures) pts.push(new THREE.Vector3(f.p.x, f.p.y, f.p.z).applyMatrix4(inv));
    return tallFov(a, pts, Math.min(62, 42 * Math.pow(0.85 / a, 0.5)));
  }
  function sizeBack() {
    takeSz = null; takeFov = null;
    if (!renderer) return;
    renderer.setPixelRatio(takePr); composer.setPixelRatio(takePr); resize();
  }
  // a hidden tab gets no animation frames: while a take runs a timer draws instead (one frame
  // waiting at a time, so the loop carries on as one when the tab comes back)
  function hiddenTake() {
    clearInterval(hiddenDraw); hiddenDraw = 0;
    if (document.hidden && taking) hiddenDraw = window.setInterval(() => { cancelAnimationFrame(raf); frame(performance.now()); }, 1000 / FPS);
  }
  // where the picture is in the canvas element (a take of another shape sits letterboxed in it)
  function shown() {
    const r = canvas!.getBoundingClientRect();
    if (!takeSz) return r;
    const k = Math.min(r.width / takeSz.w, r.height / takeSz.h), w = takeSz.w * k, h = takeSz.h * k;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  // ---- the toolbar on one row: what doesn't fit goes into More (⋯), on a phone the camera too
  let hostW = $state(1200);
  // (measured: everything is about 1070 px wide; the camera, click tools, Venue, Record and More
  // about 670; on a phone the click tools, Record and More about 270)
  // (the WebM note next to Record takes about 60 px more)
  // (wide: every tool on one row, the camera moves and the Haze/Glow/Ambient sliders too)
  const tier = $derived(hostW >= (webmOnly ? 1240 : 1195) ? 'wide' : hostW >= 700 ? 'mid' : 'narrow');
  let more = $state(false);
  let venueBtn = $state<HTMLButtonElement>(), moreBtn = $state<HTMLButtonElement>(), venueEl = $state<HTMLDivElement>();
  // (from More, which closes: the keys go on in the panel, not lost on the page)
  function openVenue(fromMore: boolean) {
    venuePanel = true; more = false;
    if (fromMore) void tick().then(() => venueEl?.querySelector<HTMLElement>('button.load')?.focus());
  }
  function closeVenue() { venuePanel = false; (venueBtn ?? moreBtn)?.focus(); }
  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape' && venuePanel && shownNow && !dialogOpen()) { e.preventDefault(); closeVenue(); }
  }
  // the selection's panel folds to its name (kept per browser)
  const FOLD_KEY = 'luxdmx.seq.sel3d';
  let selOpen = $state((() => { try { return localStorage.getItem(FOLD_KEY) !== 'folded'; } catch { return true; } })());
  function foldSel() { selOpen = !selOpen; try { localStorage.setItem(FOLD_KEY, selOpen ? 'open' : 'folded'); } catch { /* not remembered */ } }
</script>

<svelte:document onfullscreenchange={() => { full = !!document.fullscreenElement; queueMicrotask(resize); }} onvisibilitychange={hiddenTake} />
<!-- (leaving the page ends a take cleanly; there's no time left to save it) -->
<svelte:window onkeydown={keys} onpagehide={() => { if (take) void stopRecording(false, true); }} />

<!-- the tools that sit in the toolbar when there's room, in More (⋯) when there isn't -->
{#snippet cameraSeg()}
  <div class="seg" role="group" aria-label="Camera">
    {#each Object.entries(VIEWS) as [k, label] (k)}<button class="ghost" onclick={() => { view(k as ViewKey); more = false; }}>{label}</button>{/each}
    <button class="ghost" class:on={!!camMode} aria-pressed={!!camMode} onclick={() => (camMode ? stopCam() : startCam(camPick))} title={camMode ? `${picked.says}. Click or drag the stage to stop` : picked.says}>{picked.name}</button>
    <button class="ghost caret" data-popover-toggle class:on={camMenu} aria-expanded={camMenu} aria-controls="cam-moves" aria-label="Pick a camera move" title="How the camera moves by itself: Tour, Broadcast, Crane, Steadicam, Drone, Band cam" onclick={openMoves}><Icon name="down" size={12} /></button>
  </div>
  {#if camMenu && tier === 'narrow'}{@render camMoves()}{/if}
{/snippet}
{#snippet camMoves()}
  <div class="cammoves" id="cam-moves" role="group" aria-label="Camera moves" use:dismiss={closeMoves}>
    {#each CAM_MODES as m (m.id)}
      <button class="ghost" class:on={camMode === m.id} aria-pressed={camMode === m.id} title={m.says} onclick={() => { startCam(m.id); more = false; }}><b>{m.name}</b><span>{m.line}</span></button>
    {/each}
  </div>
{/snippet}
{#snippet looks()}
  <label class="slide" title="How much haze is in the air: how much of the beams you see (the fog and haze machines add to it)">Haze <input type="range" min="0" max="1" step="0.05" bind:value={hazeAmt} aria-label="Haze in the air" /></label>
  <label class="slide" title="The glow round bright lenses (0: none; it costs a little speed)">Glow <input type="range" min="0" max="0.8" step="0.05" bind:value={glow} aria-label="Glow" /></label>
  <label class="slide" title="The room's own light besides your lights (the sky, the house, reflections): 0 is a dark venue where only your lights show anything">Ambient <input type="range" min="0" max="1" step="0.01" bind:value={ambient} aria-label="Ambient light" /></label>
{/snippet}
{#snippet sizePick()}
  <label class="slide" title="How big the video is: 1080p is 1920 x 1080 whatever the window, 9:16 is 1080 x 1920 for phones (Reels, Stories), As shown is the 3D stage as it is on the screen">Video
    <select bind:value={videoSize} disabled={!!take} aria-label="Video size"><option value="1080p">1080p</option><option value="vertical">9:16</option><option value="shown">As shown</option></select></label>
  {#if webmOnly}<span class="webm" role="note" aria-label="WebM only" title={WEBM_NOTE}>WebM</span>{/if}
{/snippet}
{#snippet fullBtn(text: boolean)}
  <button class="ghost" onclick={fullscreen} aria-label={full ? 'Leave full screen' : 'Full screen'} title="Full screen (for a presentation)"><Icon name={full ? 'close' : 'eye'} />{#if text}{full ? 'Leave full screen' : 'Full screen'}{/if}</button>
{/snippet}

<!-- (only while its view is shown: a hidden view's stage keeps its parts and its state, not its
     page elements; folded away it measures 0, the toolbar keeps the layout it had) -->
{#if shownNow}
<div class="s3" class:narrow={tier === 'narrow'} bind:this={host} bind:clientWidth={() => hostW, (v) => { if (v > 0) hostW = v; }}>
  <!-- the canvas comes from the world (built here, or handed on from the last view: see the top) -->
  <div class="cv" bind:this={cvHost}></div>
  <div class="top">
    <div class="tools" role="toolbar" aria-label="3D stage">
      {#if tier !== 'narrow'}{@render cameraSeg()}{/if}
      {#if !readonly}
        <div class="seg" role="group" aria-label="What a click does">
          <button class="ghost" class:on={mode === 'select'} aria-pressed={mode === 'select'} onclick={() => (mode = 'select')} title="Click a light to select it (Shift adds)">Select</button>
          <button class="ghost" class:on={mode === 'move'} aria-pressed={mode === 'move'} onclick={() => (mode = 'move')} title="Drag the arrows to move the selected light; let go near a truss and it hangs on it">Move</button>
          <button class="ghost" class:on={mode === 'turn'} aria-pressed={mode === 'turn'} onclick={() => (mode = 'turn')} title="Drag the rings to turn the selected light">Turn</button>
          <button class="ghost" class:on={mode === 'aim'} aria-pressed={mode === 'aim'} onclick={() => (mode = 'aim')} title="Click on the stage: the selected moving heads point there">Aim</button>
          {#if app.selected.length === 1 && app.kinds[app.selected[0]] === 'mover'}
            <button class="ghost" class:on={mode === 'calib'} aria-pressed={mode === 'calib'} onclick={() => (mode = 'calib')} title="Point the real head at a spot on the stage (the pan/tilt pad), then click that spot here: the 3D stage and Aim match the room">Calibrate</button>
          {/if}
        </div>
      {/if}
      <span class="grow"></span>
      {#if tier !== 'narrow' && !readonly}<button class="ghost" bind:this={venueBtn} class:on={venuePanel} aria-expanded={venuePanel} onclick={() => (venuePanel ? closeVenue() : openVenue(false))} title="Your own venue as a 3D model (.glb), or the built-in stage">Venue</button>{/if}
      {#if tier === 'wide'}{@render looks()}{/if}
      {#if take}
        <div class="seg recseg" role="group" aria-label="Recording">
          <span class="rec" role="timer" aria-label="Recording: {clock(recSecs)}"><span class="dot"></span>REC {clock(recSecs)}</span>
          <button class="ghost" onclick={() => void stopRecording()} aria-label="Stop and save the video" title="Stop recording and save the video file"><Icon name="stop" size={14} />{#if tier !== 'narrow'}Stop{/if}</button>
        </div>
      {:else}
        <button class="ghost recbtn" class:off={!recordable} onclick={record} aria-label="Record a video"
          title={recordable ? `Record a video of the 3D stage with the song (${SIZE_SAYS[videoSize]}); Stop saves it${webmOnly ? `. ${WEBM_NOTE}` : ''}` : 'This browser can\'t record video here'}><Icon name="record" size={14} />{#if tier !== 'narrow'}Record{/if}</button>
      {/if}
      {#if tier === 'wide'}
        {@render sizePick()}{@render fullBtn(false)}
      {:else}
        <button class="ghost" bind:this={moreBtn} data-popover-toggle class:on={more} aria-expanded={more} aria-label="More" title="More: {tier === 'narrow' ? 'camera, ' : ''}haze, glow, {readonly || tier !== 'narrow' ? '' : 'venue, '}video size, full screen" onclick={() => (more = !more)}><Icon name="more" /></button>
      {/if}
    </div>
    {#if camMenu && tier !== 'narrow'}{@render camMoves()}{/if}
    {#if more && tier !== 'wide'}
      <div class="more" role="group" aria-label="More for the 3D stage" use:dismiss={() => { const inside = !!document.activeElement?.closest('.more'); more = false; if (inside) moreBtn?.focus(); }}>
        {#if tier === 'narrow'}{@render cameraSeg()}{/if}
        <div class="row">{@render looks()}</div>
        <div class="row">
          {#if !readonly && tier === 'narrow'}<button class="ghost" onclick={() => openVenue(true)} title="Your own venue as a 3D model (.glb), or the built-in stage">Venue…</button>{/if}
          {@render sizePick()}
          {@render fullBtn(true)}
        </div>
      </div>
    {/if}
    {#if venuePanel && !readonly}
      <div class="venue" role="group" aria-label="The venue" bind:this={venueEl}>
        <div class="vhead"><b>Venue</b><button class="ghost x" onclick={closeVenue} aria-label="Close the venue panel" title="Close (Esc)"><Icon name="close" size={14} /></button></div>
        <div class="seg rooms" role="group" aria-label="Room">
          <button class="ghost" class:on={room.id === 'hall'} aria-pressed={room.id === 'hall'} onclick={() => setRoom('hall')} title="A big stage in a hall: truss, LED walls, a few hundred people">Big stage</button>
          <button class="ghost" class:on={room.id === 'pub'} aria-pressed={room.id === 'pub'} onclick={() => setRoom('pub')} title="A small club or pub: a small stage under a low ceiling, a bar at the back, a few dozen people. Lights you placed by hand stay where you put them; Reset puts them on its rig.">Small club / pub</button>
          <button class="ghost" class:on={room.id === 'club'} aria-pressed={room.id === 'club'} onclick={() => setRoom('club')} title="A club: a DJ booth on a stage, LED strips round it, a dance floor with a bar and a mirror ball">Club</button>
          <button class="ghost" class:on={room.id === 'party'} aria-pressed={room.id === 'party'} onclick={() => setRoom('party')} title="No stage: a square of truss over the crowd on four legs, speakers in the corners, the DJ on the floor">Party</button>
          <button class="ghost" class:on={room.id === 'truss'} aria-pressed={room.id === 'truss'} onclick={() => setRoom('truss')} title="An empty room with one truss on two towers: for trying lights out">Test truss</button>
        </div>
        <label class="fld bandname"><span>Band name (on the banners and screens)</span>
          <input type="text" maxlength="60" value={app.show.settings.bandName ?? ''} placeholder="Empty: the band's picture" aria-label="Band name"
            oninput={(e) => previewBand((e.target as HTMLInputElement).value)} onchange={(e) => setBandName((e.target as HTMLInputElement).value)} onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') setBandName((e.target as HTMLInputElement).value); }} /></label>
        <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden bind:this={modelFile} onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void loadModel(f); }} />
        <button class="load" onclick={() => modelFile?.click()}>{vm ? 'Another model…' : 'Load a 3D model (.glb)…'}</button>
        {#if vm}
          <span class="faint name" title={vm.name}>{vm.name}</span>
          {#each [['scale', 'Size ×', 0.1], ['x', 'X m', 0.1], ['y', 'Height m', 0.1], ['z', 'Z m', 0.1], ['yaw', 'Turn °', 5]] as const as [k, label, step] (k)}
            <label class="fld"><span>{label}</span><input type="number" step={step} value={vm[k]} aria-label="Model {label}" onchange={(e) => setModel(k, (e.target as HTMLInputElement).valueAsNumber)} onkeydown={(e) => e.stopPropagation()} /></label>
          {/each}
          <button class="ghost" onclick={removeModel}>Remove it</button>
        {/if}
        <label class="ck"><input type="checkbox" checked={!app.show.settings.stage3d?.hideVenue} onchange={(e) => setHideVenue(!(e.target as HTMLInputElement).checked)} /> The built-in stage (band, truss, crowd)</label>
        {#if room.id === 'hall' || room.id === 'pub'}<label class="ck" title="Like a real show's screens: what a TV director's cameras film, live (off: the band's name)"><input type="checkbox" checked={liveScreens} onchange={(e) => setLiveScreens((e.target as HTMLInputElement).checked)} /> The live camera on the screens</label>{/if}
      </div>
    {/if}
    <!-- (up here, under the toolbar: never over the selection's numbers at the bottom) -->
    {#if mode === 'aim' && !readonly}<p class="aimhint">Click on the stage: the selected moving heads point there.</p>{/if}
    {#if mode === 'calib' && !readonly}<p class="aimhint">Point the real head at a spot on the stage (pan/tilt pad), then click that spot here.</p>{/if}
  </div>
  {#if !readonly && app.selected.length}
    <div class="sel" class:folded={!selOpen} role="group" aria-label="The selected lights">
      <div class="row1">
        <button class="ghost fold" onclick={foldSel} aria-expanded={selOpen} title={selOpen ? 'Fold this away' : 'Where they are and how they\'re turned'}><Icon name={selOpen ? 'down' : 'up'} size={13} /><b>{pickedName}</b></button>
        {#if selOpen}
          <button class="ghost" onclick={() => mount('hang')} title="On the nearest truss, hanging">Hang</button>
          <button class="ghost" onclick={() => mount('deck')} title="Standing on the deck">On the deck</button>
          <button class="ghost" onclick={() => mount('floor')} title="On the floor in front of the stage">In front</button>
          {#if selFx.length > 2}<button class="ghost" onclick={spread} title="Evenly between the outermost two">Spread</button>{/if}
          <button class="ghost" onclick={resetPlace} title="Back to where the plan puts them">Reset</button>
        {/if}
      </div>
      <!-- one value for all of them (empty: they differ), or − / + to move each one by a step -->
      {#if selOpen}
      <div class="fields">
        {#each FIELDS as [k, label, step] (k)}
          <label class="fld"><span>{label}</span>
            <span class="nud">
              <button class="ghost" onclick={() => setEach(k, (v) => v - step)} aria-label="{label} less">−</button>
              <input type="number" step={step} value={common(k)} placeholder="mixed" aria-label={label}
                onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(v)) setEach(k, () => v); }}
                onkeydown={(e) => e.stopPropagation()} />
              <button class="ghost" onclick={() => setEach(k, (v) => v + step)} aria-label="{label} more">+</button>
            </span></label>
        {/each}
      </div>
      {/if}
    </div>
  {/if}
</div>
{/if}

<style>
  .s3 { position: relative; flex: 1; min-height: 0; border-radius: var(--radius-s); overflow: hidden; background: #040507; }
  .cv { display: contents; }
  .cv :global(canvas) { display: block; width: 100%; height: 100%; touch-action: none; }
  /* a take of another shape than the window: shown whole, with bars */
  .cv :global(canvas.take) { object-fit: contain; }
  /* the toolbar and what opens under it, one under the other: a panel never covers the toolbar */
  .top { position: absolute; left: .4rem; right: .4rem; top: .4rem; max-height: calc(100% - .8rem); display: flex; flex-direction: column; align-items: flex-start; gap: .4rem; pointer-events: none; }
  /* one row; what doesn't fit scrolls sideways (the gaps let clicks through to the stage) */
  .tools { align-self: stretch; display: flex; gap: .4rem; align-items: center; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding: 2px; margin: -2px; pointer-events: none; }
  .tools::-webkit-scrollbar { display: none; }
  .tools > *, .more, .venue, .aimhint, .sel { pointer-events: auto; }
  .tools > * { flex: none; }
  .tools > .grow { flex: 1; pointer-events: none; }
  .seg { display: inline-flex; background: #0b0f15cc; border: 1px solid var(--line); border-radius: 8px; padding: 2px; backdrop-filter: blur(4px); }
  .seg button, .tools > button, .more .row > button { font-size: .8rem; padding: .2rem .55rem; }
  .tools > button, .more .row > button { background: #0b0f15cc; border: 1px solid var(--line); }
  .slide { display: inline-flex; align-items: center; gap: .3rem; font-size: .78rem; color: var(--muted); background: #0b0f15cc; border: 1px solid var(--line); border-radius: 8px; padding: .1rem .35rem; }
  .slide input { width: 4.6rem; }
  .slide select { font-size: .78rem; padding: .05rem .2rem; background: transparent; border-color: transparent; }
  /* Record: a red dot; while it records, the red REC chip with the time and Stop */
  .recbtn :global(svg) { color: #ff4d55; fill: #ff4d55; }
  .recbtn.off { opacity: .6; }
  .recseg { align-items: center; gap: 2px; }
  .rec { display: inline-flex; align-items: center; gap: .35rem; padding: .15rem .55rem; border-radius: 6px; background: #d4202a; color: #fff; font-size: .78rem; font-weight: 700; letter-spacing: .04em; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rec .dot { width: .5rem; height: .5rem; border-radius: 50%; background: #fff; animation: blink 1s steps(2, jump-none) infinite; }
  @keyframes blink { 50% { opacity: .3; } }
  @media (prefers-reduced-motion: reduce) { .rec .dot { animation: none; } }
  /* the camera moves: a short list under the toolbar (in More on a phone), each with what it does */
  .seg .caret { padding: .2rem .3rem; }
  .cammoves { pointer-events: auto; align-self: flex-start; max-width: min(19rem, 100%); min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; background: #0b0f15ee; border: 1px solid var(--line); border-radius: 8px; padding: .3rem; backdrop-filter: blur(6px); }
  .cammoves button { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 0; font-size: .8rem; padding: .25rem .55rem; }
  .cammoves button span { font-size: .72rem; color: var(--muted); font-weight: 400; }
  .more { align-self: flex-end; max-width: 100%; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: .4rem; background: #0b0f15ee; border: 1px solid var(--line); border-radius: 8px; padding: .45rem; backdrop-filter: blur(6px); }
  .more .row { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
  .more .seg { flex-wrap: wrap; align-self: flex-start; }
  .venue { align-self: flex-end; width: min(22rem, 100%); min-height: 0; overflow: auto; display: flex; flex-wrap: wrap; gap: .4rem; align-items: flex-end; background: #0b0f15ee; border: 1px solid var(--line); border-radius: 8px; padding: .5rem; backdrop-filter: blur(6px); }
  .vhead { flex: 1 1 100%; display: flex; align-items: center; justify-content: space-between; font-size: .85rem; }
  .vhead .x { padding: .1rem .3rem; }
  .venue .name { flex: 1 1 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .venue .fld input { width: 4.6em; padding: .1rem .25rem; font-size: .8rem; min-height: 0; }
  .venue .ck { flex: 1 1 100%; font-size: .8rem; display: flex; gap: .35rem; align-items: center; }
  .venue .rooms { flex: 1 1 100%; }
  .venue .rooms button { flex: 1; font-size: .8rem; padding: .2rem .5rem; }
  .venue .bandname { flex: 1 1 100%; }
  .venue .bandname input { width: 100%; font-size: .85rem; padding: .2rem .4rem; }
  /* a browser that only records WebM: said next to Record (the full sentence is its tooltip) */
  .webm { font-size: .72rem; color: var(--muted); background: #0b0f15cc; border: 1px dashed var(--line); border-radius: 6px; padding: .1rem .4rem; white-space: nowrap; cursor: help; }
  .grow { flex: 1; }
  .sel { position: absolute; left: .4rem; bottom: .4rem; max-width: calc(100% - .8rem); display: flex; flex-direction: column; gap: .3rem; background: #0b0f15e6; border: 1px solid var(--line); border-radius: 8px; padding: .35rem .5rem; backdrop-filter: blur(6px); }
  .sel.folded { padding: .2rem .3rem; }
  .row1 { display: flex; gap: .3rem; align-items: center; flex-wrap: wrap; }
  .sel .fold { gap: .3rem; padding-left: .3rem; }
  .fields { display: flex; gap: .45rem; flex-wrap: wrap; }
  .fld { display: flex; flex-direction: column; gap: .1rem; font-size: .7rem; color: var(--muted); }
  .nud { display: inline-flex; align-items: center; }
  /* (no spinner arrows: − and + are next to it, and "mixed" fits) */
  .nud input { width: 5em; padding: .1rem .25rem; font-size: .8rem; min-height: 0; text-align: right; appearance: textfield; -moz-appearance: textfield; }
  .nud input::-webkit-inner-spin-button, .nud input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .nud input::placeholder { color: var(--faint); font-style: italic; }
  .sel b { font-size: .85rem; }
  .sel button { font-size: .8rem; padding: .15rem .5rem; }
  .sel .nud button { min-width: 28px; min-height: 28px; padding: 0 .35rem; font-size: .95rem; }
  /* a phone: the panel's two rows scroll sideways instead of piling up over the stage */
  .narrow .sel:not(.folded) { right: .4rem; }
  .narrow .row1, .narrow .fields { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .narrow .row1 > *, .narrow .fields > * { flex: none; }
  @media (pointer: coarse) {
    .sel .nud button, .sel .nud input { min-height: 44px; }
    .sel .nud button { min-width: 40px; }
  }
  .aimhint { align-self: center; max-width: 100%; margin: 0; background: #0b0f15d9; border: 1px solid var(--accent); color: var(--accent); border-radius: 999px; padding: .25rem .8rem; font-size: .85rem; text-align: center; }
  .s3:fullscreen { border-radius: 0; }
</style>
