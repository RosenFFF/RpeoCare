import * as THREE from 'three';

// The canvas is decorative. Branch selection stays in stable native buttons.
export function createBranchOrbitScene(host: HTMLDivElement, scroller: HTMLDivElement, onFailure: () => void) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0, 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 1000);
  camera.position.z = 400;
  const ringGeometry = new THREE.TorusGeometry(49, .65, 6, 96);
  const outerGeometry = new THREE.TorusGeometry(62, .35, 4, 96, Math.PI * 1.55);
  const coreGeometry = new THREE.IcosahedronGeometry(17, 1);
  const dotGeometry = new THREE.SphereGeometry(2.3, 8, 6);
  const particleGeometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (let i = 0; i < 68; i++) {
    const angle = i * 2.399963;
    const radius = 26 + ((i * 17) % 37);
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(i * 1.7) * 19);
  }
  particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  type Portal = {
    anchor: HTMLElement; group: THREE.Group; rings: THREE.Mesh[]; core: THREE.Mesh;
    particles: THREE.Points; dot: THREE.Mesh; materials: THREE.Material[]; phase: number;
  };
  const portals = new Map<HTMLElement, Portal>();
  let disposed = false, paused = true, inView = true, frame = 0, elapsed = 0, previous = 0, dirty = true;
  let width = 1, height = 1, lastDraw = 0;

  function add(anchor: HTMLElement) {
    if (portals.has(anchor) || portals.size >= 40) return;
    const color = anchor.dataset.tone === 'default' ? '#72ead5' : anchor.dataset.tone === 'protected' ? '#94b8ff' : '#b5c8e2';
    const line = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8 });
    const faint = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .28 });
    const coreMat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .7 });
    const points = new THREE.PointsMaterial({ color, size: 1.5, transparent: true, opacity: .65, sizeAttenuation: false });
    const group = new THREE.Group();
    const rings = [new THREE.Mesh(ringGeometry, line), new THREE.Mesh(ringGeometry, faint), new THREE.Mesh(outerGeometry, line)];
    rings[1].scale.setScalar(1.12);
    const core = new THREE.Mesh(coreGeometry, coreMat);
    const particles = new THREE.Points(particleGeometry, points);
    const dot = new THREE.Mesh(dotGeometry, line);
    group.add(...rings, core, particles, dot); scene.add(group);
    // A name-derived phase differentiates motion without implying a Git metric.
    const phase = [...(anchor.dataset.branchPortal || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 31;
    portals.set(anchor, { anchor, group, rings, core, particles, dot, materials: [line, faint, coreMat, points], phase });
    anchor.classList.add('is-rendered'); dirty = true;
  }
  function remove(anchor: HTMLElement) {
    const portal = portals.get(anchor); if (!portal) return;
    scene.remove(portal.group); portal.materials.forEach(material => material.dispose());
    anchor.classList.remove('is-rendered'); portals.delete(anchor); dirty = true;
  }
  function layout() {
    const rect = host.getBoundingClientRect();
    portals.forEach(portal => {
      const bounds = portal.anchor.getBoundingClientRect();
      portal.group.position.set(bounds.left - rect.left + bounds.width / 2 - width / 2, height / 2 - (bounds.top - rect.top + bounds.height / 2), 0);
      portal.group.scale.setScalar(Math.min(bounds.width / 170, bounds.height / 150));
    });
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || !inView || document.hidden) return;
    if (!paused && now - lastDraw < 32) { schedule(); return; }
    elapsed += paused ? 0 : Math.min((now - previous) / 1000, .06);
    previous = now; lastDraw = now;
    if (dirty) layout();
    portals.forEach(portal => {
      const t = elapsed * .24 + portal.phase;
      const active = portal.anchor.closest('button')?.matches(':hover, :focus-visible') ?? false;
      portal.rings[0].rotation.set(.65, .35, t);
      portal.rings[1].rotation.set(1.1, t * .5, -.4);
      portal.rings[2].rotation.set(-.55, .4, -t * .65);
      portal.core.rotation.set(t * .5, t * .6, .2);
      portal.core.scale.setScalar(active ? 1.25 : 1);
      portal.particles.rotation.z = t * .15;
      portal.dot.position.set(Math.cos(t) * 49, Math.sin(t) * 49 * .8, Math.sin(t) * 24);
    });
    renderer.render(scene, camera); dirty = false;
    if (!paused) schedule();
  }
  function schedule() { if (!frame && !disposed && inView && !document.hidden) frame = requestAnimationFrame(draw); }
  function update() { dirty = true; schedule(); }
  function resize() {
    width = host.clientWidth; height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2;
    camera.updateProjectionMatrix(); update();
  }
  const anchors = [...scroller.querySelectorAll<HTMLElement>('[data-branch-portal]')];
  const nodes = new IntersectionObserver(entries => {
    // Release offscreen objects first, keeping GPU work bounded for large directories.
    entries.filter(entry => !entry.isIntersecting).forEach(entry => remove(entry.target as HTMLElement));
    entries.filter(entry => entry.isIntersecting).forEach(entry => add(entry.target as HTMLElement));
    update();
  }, { root: scroller, rootMargin: '60px' });
  anchors.forEach(anchor => nodes.observe(anchor));
  const observer = new ResizeObserver(resize); observer.observe(host); observer.observe(scroller);
  const visibility = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; update(); }); visibility.observe(host);
  const failure = (event: Event) => { event.preventDefault(); onFailure(); };
  renderer.domElement.addEventListener('webglcontextlost', failure);
  scroller.addEventListener('scroll', update, { passive: true });
  scroller.addEventListener('pointerover', update); scroller.addEventListener('pointerout', update);
  scroller.addEventListener('focusin', update); scroller.addEventListener('focusout', update);
  document.addEventListener('visibilitychange', update);
  resize();
  return {
    pause(value: boolean) { paused = value; previous = performance.now(); update(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); nodes.disconnect(); observer.disconnect(); visibility.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', failure);
      scroller.removeEventListener('scroll', update); scroller.removeEventListener('pointerover', update); scroller.removeEventListener('pointerout', update);
      scroller.removeEventListener('focusin', update); scroller.removeEventListener('focusout', update);
      document.removeEventListener('visibilitychange', update);
      [...portals.keys()].forEach(remove);
      [ringGeometry, outerGeometry, coreGeometry, dotGeometry, particleGeometry].forEach(resource => resource.dispose());
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
