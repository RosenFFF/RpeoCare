import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// A single open, gently twisted ribbon, designed for the public brand page.
export function createBrandScene(host: HTMLDivElement, onFailure: () => void) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 40);
  const home = new THREE.Vector3(0, .15, 8.1);
  camera.position.copy(home);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = true;
  controls.rotateSpeed = .45;
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = generator.fromScene(room, .035);
  scene.environment = environment.texture;
  room.dispose(); generator.dispose();
  scene.add(new THREE.HemisphereLight(0xf0f6ff, 0x466057, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-3, 4, 6); scene.add(light);
  const rim = new THREE.DirectionalLight(0xb7cec7, 2); rim.position.set(4, -2, 1); scene.add(rim);
  const group = new THREE.Group(); group.rotation.set(.3, -.4, -.24); scene.add(group);
  const positions: number[] = [], indices: number[] = [];
  const steps = 240, sides = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = .48 + t * (Math.PI * 2 - .96);
    const twist = -.35 + t * Math.PI * 1.22;
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      // A rounded rectangular cross section catches a long, soft highlight.
      const u = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), .4) * .51;
      const v = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), .4) * .105;
      const radial = u * Math.cos(twist) - v * Math.sin(twist);
      const depth = u * Math.sin(twist) + v * Math.cos(twist);
      positions.push((1.84 + radial) * Math.cos(angle), (1.84 + radial) * Math.sin(angle), depth);
    }
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    indices.push(a, b, a + sides, b, b + sides, a + sides);
  }
  for (const end of [0, steps]) {
    const offset = end * sides;
    for (let j = 1; j < sides - 1; j++) {
      if (end === 0) indices.push(offset, offset + j + 1, offset + j);
      else indices.push(offset, offset + j, offset + j + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const material = new THREE.MeshPhysicalMaterial({ color: 0xcbd6d8, metalness: .88, roughness: .24, clearcoat: .35, clearcoatRoughness: .25, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(geometry, material));
  let disposed = false, visible = true, frame = 0, dragging = false;
  let targetX = 0, targetY = 0;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  function draw() {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const changed = controls.update();
    const dx = targetX - group.rotation.x, dy = targetY - group.rotation.y;
    group.rotation.x += dx * .065; group.rotation.y += dy * .065;
    renderer.render(scene, camera);
    if (changed || Math.abs(dx) + Math.abs(dy) > .001) schedule();
  }
  function schedule() { if (!frame && !disposed && visible && !document.hidden) frame = requestAnimationFrame(draw); }
  function reset() { targetX = .3; targetY = -.4; camera.position.copy(home); controls.target.set(0, 0, 0); controls.update(); schedule(); }
  const move = (event: PointerEvent) => {
    if (motion.matches || dragging || event.pointerType !== "mouse") return;
    const rect = host.getBoundingClientRect();
    targetX = .3 + ((event.clientY - rect.top) / rect.height - .5) * .22;
    targetY = -.4 + ((event.clientX - rect.left) / rect.width - .5) * .3; schedule();
  };
  const leave = () => { targetX = .3; targetY = -.4; schedule(); };
  const start = () => { dragging = true; };
  const end = () => { dragging = false; };
  const fail = (event: Event) => { event.preventDefault(); onFailure(); };
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h;
    camera.fov = w / h < 1 ? 43 : 38; camera.updateProjectionMatrix(); schedule();
  };
  const theme = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    material.color.set(dark ? 0xa3b8be : 0xcbd6d8);
    renderer.toneMappingExposure = dark ? 1.15 : 1.35; schedule();
  };
  const ro = new ResizeObserver(resize); ro.observe(host);
  const io = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; schedule(); }); io.observe(host);
  const mo = new MutationObserver(theme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  controls.addEventListener("change", schedule); controls.addEventListener("start", start); controls.addEventListener("end", end);
  host.addEventListener("pointermove", move); host.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("webglcontextlost", fail);
  document.addEventListener("visibilitychange", schedule); motion.addEventListener("change", leave);
  reset(); resize(); theme();
  return { reset, dispose() {
    if (disposed) return; disposed = true; cancelAnimationFrame(frame);
    ro.disconnect(); io.disconnect(); mo.disconnect();
    host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave);
    document.removeEventListener("visibilitychange", schedule); motion.removeEventListener("change", leave);
    renderer.domElement.removeEventListener("webglcontextlost", fail);
    controls.dispose(); geometry.dispose(); material.dispose(); environment.dispose(); renderer.dispose(); renderer.domElement.remove();
  } };
}
