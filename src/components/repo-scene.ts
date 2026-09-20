import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function createRepoScene(host: HTMLDivElement, labels: (HTMLButtonElement | null)[], onSelect: (index: number) => void, onFailure: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 60);
  const home = new THREE.Vector3(3.1, 4.1, 7.8);
  camera.position.copy(home);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = true;
  controls.minPolarAngle = .5; controls.maxPolarAngle = 1.3;
  controls.rotateSpeed = .5;
  controls.target.set(0, .5, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x526b61, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-3, 7, 5); scene.add(key);
  const model = new THREE.Group(); scene.add(model);
  const resources: { dispose: () => void }[] = [];
  function material(color: string, metalness = .3, roughness = .3) {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness }); resources.push(m); return m;
  }
  const ceramic = material("#eeeae1", .12, .3);
  const metal = material("#8b958e", .78, .25);
  const dark = material("#214837", .32, .28);
  const ringMaterial = material("#9aa99d", .75, .25);
  const branchMat = material("#3b6c52", .4, .24);
  const colors = ["#bb885c", "#778ba6", "#6b9680", "#8c899e"];
  const nodeMaterials = colors.map(c => material(c, .25, .3));
  const ink = material("#f9f4e9", .08, .35);

  function shape(points: number[][]) {
    const result = new THREE.Shape();
    points.forEach(([x,y],i)=>i===0?result.moveTo(x,y):result.lineTo(x,y));
    result.closePath();return result;
  }
  function rounded(w:number,h:number,r:number) {
    const s=new THREE.Shape();const x=-w/2,y=-h/2;
    s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
    s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
    s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
  }
  function extrude(outline:THREE.Shape,depth:number,mat:THREE.Material,group:THREE.Group,bevel=.055) {
    const g=new THREE.ExtrudeGeometry(outline,{depth,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:24});
    g.translate(0,0,-depth/2);resources.push(g);
    const mesh=new THREE.Mesh(g,mat);group.add(mesh);return mesh;
  }
  function stroke(points:number[][],mat:THREE.Material,group:THREE.Group,radius=.035,smooth=false) {
    const vectors=points.map(p=>new THREE.Vector3(...p as [number,number,number]));
    const curve=smooth?new THREE.CatmullRomCurve3(vectors):new THREE.CurvePath<THREE.Vector3>();
    if(curve instanceof THREE.CurvePath)for(let i=1;i<vectors.length;i++)curve.add(new THREE.LineCurve3(vectors[i-1],vectors[i]));
    const g=new THREE.TubeGeometry(curve,48,radius,12,false);resources.push(g);
    const m=new THREE.Mesh(g,mat);group.add(m);return m;
  }
  function orb(x:number,y:number,z:number,r:number,mat:THREE.Material,group:THREE.Group) {
    const g=new THREE.SphereGeometry(r,24,16);resources.push(g);const m=new THREE.Mesh(g,mat);m.position.set(x,y,z);group.add(m);return m;
  }
  // A real folder silhouette: raised tab, inset papers and a curved front pocket.
  const core=new THREE.Group();core.position.set(0,.38,0);core.rotation.y=.08;model.add(core);
  const folder=shape([[-.94,-.62],[.94,-.62],[.94,.53],[.05,.53],[-.12,.77],[-.78,.77],[-.94,.62]]);
  const back=extrude(folder,.14,dark,core,.07);back.position.z=-.2;
  for(let i=0;i<3;i++){
    const paper=extrude(rounded(1.62,1.12,.055),.035,i===1?metal:ceramic,core,.018);
    paper.position.set((i-1)*.025,.08+i*.055,-.12+i*.09);paper.rotation.z=(i-1)*.025;
  }
  const front=extrude(rounded(1.94,1.12,.15),.18,ceramic,core,.065);front.position.set(0,-.1,.28);front.rotation.x=-.08;
  // Raised code glyph on the folder, with small metallic registry marks.
  stroke([[-.28,.15,.44],[-.48,-.04,.46],[-.28,-.23,.48]],branchMat,core,.039);
  stroke([[.28,.15,.44],[.48,-.04,.46],[.28,-.23,.48]],branchMat,core,.039);
  stroke([[.09,.22,.44],[-.09,-.3,.48]],branchMat,core,.032);
  for(let i=0;i<3;i++)orb(.57+i*.085,-.48,.47,.018,metal,core);
  stroke([[-.75,-.5,.45],[0,-.52,.46],[.75,-.5,.45]],metal,core,.009,true);

  // The open C arc is a single brushed-metal sweep, leaving breathing room at the front.
  const orbit=new THREE.Group();orbit.position.set(0,-.17,-.05);orbit.rotation.x=-Math.PI/2;orbit.rotation.z=.28;model.add(orbit);
  const arcGeo=new THREE.TorusGeometry(2.46,.065,16,150,Math.PI*1.64);resources.push(arcGeo);
  const arc=new THREE.Mesh(arcGeo,ringMaterial);orbit.add(arc);
  for(const t of [0,Math.PI*1.64])orb(Math.cos(t)*2.46,Math.sin(t)*2.46,0,.067,ringMaterial,orbit);
  const accentGeo=new THREE.TorusGeometry(2.46,.073,16,32,.42);resources.push(accentGeo);
  const accentArc=new THREE.Mesh(accentGeo,branchMat);accentArc.rotation.z=2.9;orbit.add(accentArc);

  const positions=[[-2.07,.3,.72],[1.9,.08,1.0],[-1.6,1.08,-1.25],[1.65,1.02,-1.1]];
  const nodes=positions.map(([x,y,z],i)=>{
    const group=new THREE.Group();group.position.set(x,y,z);group.rotation.y=.26;group.rotation.z=i%2===0?-.09:.08;model.add(group);
    if(i===0){
      // Feedback: rounded speech bubble with an integral tail and three inset dots.
      const bubble=rounded(.84,.6,.17);
      const body=extrude(bubble,.15,nodeMaterials[i],group,.045);
      const tail=extrude(shape([[-.26,-.2],[-.27,-.47],[.01,-.26]]),.14,nodeMaterials[i],group,.025);
      body.position.y=.1;tail.position.y=.1;
      for(let j=0;j<3;j++)orb(-.19+j*.19,.1,.135,.04,ink,group);
    }else if(i===1){
      // Pull request: two sculpted branch rails, rather than another square tile.
      stroke([[-.24,-.35,0],[-.24,.38,0]],nodeMaterials[i],group,.075);
      stroke([[.27,-.33,0],[.27,-.04,0],[.05,.12,0],[.02,.39,0]],nodeMaterials[i],group,.07,true);
      for(const [px,py] of [[-.24,-.36],[-.24,.39],[.27,-.34]]){
        const g=new THREE.TorusGeometry(.105,.049,12,32);resources.push(g);const m=new THREE.Mesh(g,nodeMaterials[i]);m.position.set(px,py,0);group.add(m);
      }
      stroke([[-.1,.25,0],[.02,.4,0],[.15,.26,0]],nodeMaterials[i],group,.05);
    }else if(i===2){
      // Documentation: a bevelled sheet with a folded upper corner and raised lines.
      const page=shape([[-.32,-.43],[.32,-.43],[.32,.2],[.08,.44],[-.32,.44]]);
      extrude(page,.11,ceramic,group,.035);
      extrude(shape([[.08,.44],[.08,.2],[.32,.2]]),.12,nodeMaterials[i],group,.02).position.z=.04;
      for(let j=0;j<3;j++)stroke([[-.18,.1-j*.15,.1],[j===2?.05:.18,.1-j*.15,.1]],nodeMaterials[i],group,.022);
    }else{
      // Health: a curved shield silhouette, clearly distinct from the document.
      const shield=new THREE.Shape();shield.moveTo(0,.47);shield.bezierCurveTo(.12,.36,.33,.34,.38,.31);shield.lineTo(.34,-.08);shield.bezierCurveTo(.3,-.29,.12,-.43,0,-.5);shield.bezierCurveTo(-.12,-.43,-.3,-.29,-.34,-.08);shield.lineTo(-.38,.31);shield.bezierCurveTo(-.2,.35,-.12,.36,0,.47);
      extrude(shield,.15,nodeMaterials[i],group,.045);
      stroke([[-.17,-.02,.14],[-.035,-.16,.14],[.2,.14,.14]],ink,group,.038);
    }
    // Invisible hit volume makes the whole sculptural object easy to click.
    const hitMaterial=new THREE.MeshBasicMaterial({visible:false});resources.push(hitMaterial);
    const hitGeo=new THREE.SphereGeometry(.62,16,12);resources.push(hitGeo);
    const mesh=new THREE.Mesh(hitGeo,hitMaterial);mesh.userData.index=i;group.add(mesh);
    return {group,mesh,base:y};
  });
  const haloGeo=new THREE.TorusGeometry(.57,.017,8,64);resources.push(haloGeo);
  const halo=new THREE.Mesh(haloGeo,branchMat);halo.rotation.x=-Math.PI/2;model.add(halo);
  // Soft contact shadow, generated locally without external assets.
  const shadowCanvas=document.createElement("canvas");shadowCanvas.width=128;shadowCanvas.height=128;
  const ctx=shadowCanvas.getContext("2d")!;
  const gradient=ctx.createRadialGradient(64,64,5,64,64,64);gradient.addColorStop(0,"rgba(17,39,29,.24)");gradient.addColorStop(1,"rgba(17,39,29,0)");ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);resources.push(shadowTexture);
  const shadowMat=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false});resources.push(shadowMat);
  const shadowGeo=new THREE.PlaneGeometry(7,7);resources.push(shadowGeo);
  const shadow=new THREE.Mesh(shadowGeo,shadowMat);shadow.rotation.x=-Math.PI/2;shadow.position.y=-.55;scene.add(shadow);

  let selected=0, paused=false, visible=true, disposed=false, frame=0, last=0, elapsed=0, dirty=true;
  const project=new THREE.Vector3(); const ray=new THREE.Raycaster();
  let downX=0,downY=0;
  const down=(e:PointerEvent)=>{downX=e.clientX;downY=e.clientY;};
  const up=(e:PointerEvent)=>{
    if(Math.hypot(e.clientX-downX,e.clientY-downY)>6)return;
    const rect=host.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
    const hit=ray.intersectObjects(nodes.map(n=>n.mesh))[0];if(hit)onSelect(hit.object.userData.index);
  };
  const fail=(e:Event)=>{e.preventDefault();onFailure();};
  renderer.domElement.addEventListener("pointerdown",down);renderer.domElement.addEventListener("pointerup",up);renderer.domElement.addEventListener("webglcontextlost",fail);
  const markDirty=()=>{dirty=true;schedule();};controls.addEventListener("change",markDirty);
  function draw(now:number) {
    frame=0;if(disposed||!visible||document.hidden)return;
    const dt=Math.min((now-last)/1000,.04);last=now;
    controls.update();
    if(!paused){elapsed+=dt;dirty=true;}
    if(dirty){
      nodes.forEach((n,i)=>{n.group.position.y=n.base+(paused?0:Math.sin(elapsed*.8+i*1.6)*.065);});
      halo.position.copy(nodes[selected].group.position);halo.position.y-=.53;
      renderer.render(scene,camera);
      nodes.forEach((n,i)=>{
        if(!labels[i])return;
        project.copy(n.group.position);project.y+=.78;project.project(camera);
        const half=labels[i]!.offsetWidth/2+5;
        labels[i]!.style.left=`${THREE.MathUtils.clamp((project.x*.5+.5)*host.clientWidth,half,host.clientWidth-half)}px`;
        labels[i]!.style.top=`${THREE.MathUtils.clamp((-project.y*.5+.5)*host.clientHeight,62,host.clientHeight-22)}px`;
      });dirty=false;
    }
    if(!paused)schedule();
  }
  function schedule(){if(!frame&&!disposed&&visible&&!document.hidden)frame=requestAnimationFrame(draw);}
  function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.fov=w/h<1.3?49:36;camera.updateProjectionMatrix();markDirty();}
  const ro=new ResizeObserver(resize);ro.observe(host);
  const io=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;markDirty();});io.observe(host);
  function theme(){const night=document.documentElement.dataset.theme==="dark";ceramic.color.set(night?"#c2cfc4":"#eeeae1");metal.color.set(night?"#8b9d94":"#8b958e");ringMaterial.color.set(night?"#899f92":"#9aa99d");renderer.toneMappingExposure=night?.94:1.02;markDirty();}
  const mo=new MutationObserver(theme);mo.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
  document.addEventListener("visibilitychange",markDirty);
  resize();theme();
  return {
    select(index:number){selected=index;markDirty();},
    pause(value:boolean){paused=value;markDirty();},
    reset(){camera.position.copy(home);controls.target.set(0,.5,0);controls.update();markDirty();},
    dispose(){disposed=true;cancelAnimationFrame(frame);ro.disconnect();io.disconnect();mo.disconnect();document.removeEventListener("visibilitychange",markDirty);controls.dispose();renderer.domElement.removeEventListener("pointerdown",down);renderer.domElement.removeEventListener("pointerup",up);renderer.domElement.removeEventListener("webglcontextlost",fail);resources.forEach(r=>r.dispose());environment.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
