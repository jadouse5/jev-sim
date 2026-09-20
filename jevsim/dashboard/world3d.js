import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const palette = {support:0x5b9c87, oppose:0xd88972, undecided:0x8c9cb5};
const actions = {SUPPORT:['↑','I support this'],OPPOSE:['×','I’m pushing back'],WAIT:['…','Let’s wait and see'],ASK_PEERS:['↔','What do you think?'],ADVOCATE:['↗','Let me spread the word']};
const stance = n => n>.2?'support':n<-.2?'oppose':'undecided';
const skinColors=[0xe3b997,0xc98f69,0xf0c8ac,0xb77e5e,0xdeb08e,0xedc2a2];
const shirts=[0x8eabc0,0xd49a7b,0x9daa87,0xb7a0b7,0x879ab6,0xd2bb85,0xa0bcb0,0xbf8a83];
const hairs=[0x483d37,0x685142,0x353a42,0x957252];
export class WorldStage {
  constructor(host,onSelect) {
    this.host=host;this.onSelect=onSelect;this.characters=new Map();this.materials=new Map();this.lastKey='';this.clock=new THREE.Clock();this.active=null;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xeaf0ef);this.scene.fog=new THREE.Fog(0xeaf0ef,150,280);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.autoUpdate=false;this.renderer.shadowMap.needsUpdate=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.domElement.setAttribute('aria-label','Interactive 3D world. Drag to orbit, scroll to zoom, or click a character.');this.renderer.domElement.setAttribute('role','img');host.appendChild(this.renderer.domElement);
    this.labels=document.createElement('div');this.labels.className='stage-labels';host.appendChild(this.labels);
    this.camera=new THREE.OrthographicCamera(-40,40,30,-30,.1,350);this.camera.position.set(52,57,65);this.camera.zoom=1;this.camera.lookAt(0,0,0);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,.5,0);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.minPolarAngle=.001;this.controls.maxPolarAngle=1.32;this.controls.minZoom=.65;this.controls.maxZoom=7;this.controls.maxTargetRadius=48;this.controls.addEventListener("start",()=>{this.transition=null;});
    this.scene.add(new THREE.HemisphereLight(0xf8fbff,0xc4bdac,2.5));const sun=new THREE.DirectionalLight(0xffedd7,3.1);sun.position.set(-35,65,25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-52,right:52,top:52,bottom:-52,near:1,far:140});sun.shadow.normalBias=.06;sun.shadow.bias=-.0001;this.scene.add(sun);
    this.land=new THREE.Group();this.scene.add(this.land);this.connections=new THREE.Group();this.scene.add(this.connections);this.buildTown();
    this.raycaster=new THREE.Raycaster();let down=null;
    this.renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
    this.renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=host.getBoundingClientRect();this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);const hits=this.raycaster.intersectObjects([...this.characters.values()].map(c=>c.root),true);if(hits.length){let o=hits[0].object;while(o&&!o.userData.person)o=o.parent;if(o)this.onSelect(o.userData.person);}});
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();
    this.frame=()=>{this.animation=requestAnimationFrame(this.frame);if(!host.offsetWidth||document.hidden)return;this.tick();};this.frame();
  }
  material(color,roughness=.82){const key=color+':'+roughness;if(!this.materials.has(key))this.materials.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness:0}));return this.materials.get(key);}
  mesh(geometry,color,parent,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,this.material(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  box(w,h,d,color,parent,x=0,y=0,z=0){return this.mesh(new THREE.BoxGeometry(w,h,d),color,parent,x,y,z);}
  sphere(r,color,parent,x=0,y=0,z=0){return this.mesh(new THREE.SphereGeometry(r,20,14),color,parent,x,y,z);}
  cylinder(r1,r2,h,color,parent,x=0,y=0,z=0){return this.mesh(new THREE.CylinderGeometry(r1,r2,h,24),color,parent,x,y,z);}
  roundedPlatform(w,d,r,h,color,x,y,z){const shape=new THREE.Shape(),a=-w/2,b=-d/2;shape.moveTo(a+r,b);shape.lineTo(a+w-r,b);shape.quadraticCurveTo(a+w,b,a+w,b+r);shape.lineTo(a+w,b+d-r);shape.quadraticCurveTo(a+w,b+d,a+w-r,b+d);shape.lineTo(a+r,b+d);shape.quadraticCurveTo(a,b+d,a,b+d-r);shape.lineTo(a,b+r);shape.quadraticCurveTo(a,b,a+r,b);const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:true,bevelSize:.07,bevelThickness:.07,bevelSegments:2,steps:1,curveSegments:8});const m=this.mesh(geo,color,this.land,x,y,z);m.rotation.x=-Math.PI/2;return m;}
  buildTown(){
    this.roofs=new THREE.Group();this.land.add(this.roofs);this.cityLabels=[];this.cars=[];this.cutaway=true;
    this.roundedPlatform(70,54,2,.9,0xc1cec8,0,-1,0);
    this.roundedPlatform(69.5,53.5,1.8,.08,0xdde5de,0,-.16,0);
    // A continuous street grid, cycle lanes and pedestrian crossings.
    for(const z of [-22,0,22]){this.box(62,.035,4.2,0x647581,this.land,-2,.06,z);for(let x=-30;x<29;x+=3)this.box(1.4,.012,.09,0xe6dfc4,this.land,x,.087,z);}
    for(const x of [-30,0,26]){this.box(4.2,.037,48,0x647581,this.land,x,.06,0);for(let z=-20;z<22;z+=3)this.box(.09,.012,1.4,0xe6dfc4,this.land,x,.09,z);}
    for(const z of [-3.3,3.3])this.box(54,.025,.75,0x92b8a2,this.land,-2,.09,z);
    for(const [x,z] of [[-4,0],[4,0],[0,-4],[0,4],[-26,0],[22,0]])for(let j=0;j<6;j++){const vertical=x===0;this.box(vertical?.48:3.4,.025,vertical?3.4:.48,0xf2eee0,this.land,x+(vertical?(j-2.5)*.7:0),.1,z+(vertical?0:(j-2.5)*.7));}
    for(const [x,z,w,d] of [[-15,-11,24,16],[13,-11,20,16],[-15,11,24,16],[13,11,20,16]])this.roundedPlatform(w,d,.5,.12,0xedece4,x,.08,z);
    // A waterfront makes the district legible from the overview camera.
    this.box(5.4,.09,51,0x83b8bd,this.land,31.1,.01,0);
    for(let z=-23;z<24;z+=3){this.box(2,.015,.05,0xafd7d5,this.land,30.6,.07,z);this.box(.14,.5,1,0xc6c2ad,this.land,28.3,.4,z);}
    for(const z of [-11,11]){this.box(6.4,.25,2.7,0xd8bb91,this.land,31,.28,z);this.box(6.4,.08,.1,0x8b938d,this.land,31,.95,z-1.2);this.box(6.4,.08,.1,0x8b938d,this.land,31,.95,z+1.2);}
    // Office district: an occupied low-rise cutaway plus two city towers.
    this.office(-13,-9,14,9,'OFFICES',0xb5cbd0);
    this.tower(-24,-15,5,7,9.8,0xd9e4e1,0x769da9);
    this.tower(-21,-6,5,6,6.6,0xe7dece,0x9bb4b9);
    this.sign('NORTH / BUSINESS DISTRICT',-15,1,-20.1,9);
    // Coworking floor: visible desks, monitors, lounge and meeting tables.
    this.office(13,11,15,10,'COMMON / WORKSPACE',0xc8b5a2);
    this.sign('COMMON / WORKSPACE',13,4.4,6.1,8);
    // Market street: distinct storefronts with striped awnings and terrace seating.
    this.building(-23,15,6,5,3.8,0xe9cfb2,0xba795b,'cafe');
    this.building(-15,16,6,5,4.9,0xf0ddc2,0xb88f77,'studio');
    this.building(-7,16,6,5,3.4,0xe0e5d2,0x8faaa1,'cafe');
    this.sign('SUNDAY CAFÉ',-23,3.1,17.7,4.8);this.sign('LOCAL / GOODS',-15,3.5,18.7,4.8);
    for(const [x,z] of [[-23,9],[-18,7],[-11,8],[-7,10]]){this.cylinder(.65,.65,.12,0xb99065,this.land,x,.92,z);this.cylinder(.07,.1,.8,0x697b79,this.land,x,.48,z);for(const dx of [-1,1])this.box(.6,.6,.6,0xc5b093,this.land,x+dx,.4,z);this.cylinder(1.5,.06,.45,0xe9c797,this.land,x,3,z);this.cylinder(.04,.06,2.8,0x8c8c7b,this.land,x,1.5,z);}
    // Park, civic pavilion, lawn, paths and a fountain.
    this.roundedPlatform(18,14,1.1,.05,0x99b99a,13,.23,-11);
    this.box(17,.04,2.1,0xe9dec7,this.land,13,.3,-9);this.box(2.1,.04,13,0xe9dec7,this.land,13,.3,-11);
    this.cylinder(2.8,2.9,.36,0xd4d6c6,this.land,13,.45,-12);this.cylinder(2.45,2.45,.05,0x82b7bb,this.land,13,.66,-12);this.cylinder(.6,.9,.6,0xdcd9c6,this.land,13,.96,-12);this.cylinder(1.3,1.4,.17,0xd3d6c5,this.land,13,1.3,-12);this.sphere(.28,0xa6d2cf,this.land,13,1.6,-12);
    this.building(19,-18,6,3.6,2.5,0xe9e4d5,0x7c9d8f,'studio');this.sign('CIVIC / LIBRARY',19,2.1,-16,4.9);
    for(const [x,z,s] of [[5,-17,1.25],[7,-6,1],[20,-6,1.2],[21,-13,1.05],[8,-15,.95],[18,-11,.9],[-27,-19,.85],[-27,5,.95],[-26,19,.85],[-4,7,.85],[-5,-18,.85],[4,19,.85],[23,18,.8],[23,5,.8],[-10,-19,.7]])this.tree(x,z,s);
    for(const [x,z,a] of [[8,-9,0],[18,-9,Math.PI],[10,-17,0],[-18,4,0],[5,4,0],[21,-4,0]])this.bench(x,z,a);
    for(const x of [-26,-18,-9,6,16,23])for(const z of [-3,3]){this.cylinder(.06,.09,3,0x687e7b,this.land,x,1.5,z);this.box(.65,.12,.36,0xe5d7aa,this.land,x,3.05,z);}
    for(let i=0;i<8;i++){const g=new THREE.Group();this.scene.add(g);this.box(1.7,.55,.82,[0xe9ba86,0x93aaba,0xb6c4a7,0xd7e2de][i%4],g,0,.6,0);this.box(.85,.35,.74,0x668593,g,-.12,1,0);for(const x of [-.53,.53])for(const z of [-.44,.44]){const wheel=this.cylinder(.19,.19,.1,0x354952,g,x,.32,z);wheel.rotation.x=Math.PI/2;}g.traverse(o=>{if(o.isMesh)o.castShadow=false;});this.cars.push({group:g,phase:i/8});}
    const zones=[['offices','Business district',-16,-11],['workspace','Coworking studio',13,11],['market','Market & café',-16,11],['park','Civic park',13,-11]];
    for(const [id,text,x,z] of zones){const el=document.createElement('button');el.className='district-label';el.dataset.camera=id;el.textContent=text+' ↗';el.addEventListener('click',()=>{this.flyTo(id);this.host.dispatchEvent(new CustomEvent('city-view',{bubbles:true,detail:id}));});this.labels.appendChild(el);this.cityLabels.push({el,position:new THREE.Vector3(x,.5,z===11?20:-21)});}
    this.roofs.visible=false;this.batchLand();
  }
  sign(text,x,y,z,width){const canvas=document.createElement('canvas');canvas.width=768;canvas.height=96;const ctx=canvas.getContext('2d');ctx.fillStyle='#f5f0e4';ctx.fillRect(0,0,768,96);ctx.fillStyle='#4c625f';ctx.font='600 34px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,49);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const plane=new THREE.Mesh(new THREE.PlaneGeometry(width,width/8),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));plane.position.set(x,y,z);this.land.add(plane);}
  tower(x,z,w,d,h,color,glass){const g=new THREE.Group();g.position.set(x,0,z);this.land.add(g);this.box(w,h,d,color,g,0,h/2+.2,0);this.box(w+.35,.25,d+.35,0x718581,g,0,h+.3,0);for(let y=1.1;y<h-.3;y+=1.55){this.box(w-.4,.93,.05,glass,g,0,y,d/2+.035);this.box(.05,.93,d-.4,glass,g,w/2+.035,y,0);for(let dx=-w/2+.8;dx<w/2;dx+=1.1)this.box(.08,.98,.09,color,g,dx,y,d/2+.08);}this.box(w*.65,.4,d*.45,0xa5b8b0,g,0,h+.62,0);}
  office(x,z,w,d,title,color){const g=new THREE.Group();g.position.set(x,0,z);this.land.add(g);this.box(w,.26,d,0xe4d7bf,g,0,.28,0);this.box(w,3.8,.22,color,g,0,2.1,-d/2);this.box(.22,3.8,d,color,g,-w/2,2.1,0);this.box(.22,.75,d,color,g,w/2,.7,0);this.box(w,.5,.2,color,g,0,.6,d/2);this.box(w,.18,.18,0x7c9394,g,0,3.9,d/2);for(let dx=-w/2;dx<=w/2;dx+=w/4)this.box(.12,3.6,.12,0x809899,g,dx,2.05,d/2);this.box(w-1,.02,d-1,0xd7d5c9,g,0,.43,0);
    for(const dx of [-w*.28,w*.1])for(const dz of [-d*.26,d*.18]){this.box(2.4,.12,1.1,0xd3aa7c,g,dx,1.2,dz);for(const side of [-1,1])this.box(.12,.8,.7,0x84948b,g,dx+side, .77,dz);this.box(.9,.58,.08,0x4e6a71,g,dx,1.56,dz-.22);this.box(.9,.48,.02,0xacc9c8,g,dx,1.57,dz-.17);this.box(.1,.24,.1,0x657a7b,g,dx,1.29,dz-.22);this.box(.8,.06,.25,0x849b9d,g,dx,1.29,dz+.19);this.box(.78,.12,.78,0x92a7a0,g,dx,.75,dz+1.1);this.box(.78,.7,.12,0x92a7a0,g,dx,1.05,dz+1.4);}
    this.box(2.1,.13,3.6,0xc2a174,g,w*.32,1.2,0);this.box(.4,.8,2.8,0x9eab9f,g,w*.32,.78,0);for(const dz of [-1,1])for(const dx of [w*.32-1.4,w*.32+1.4])this.box(.65,.65,.65,0xa0b7ad,g,dx,.8,dz);
    this.box(3,.85,.65,0x92aeb6,g,-w*.26,.85,-d/2+.55);this.box(2.4,.02,.7,0xb1c0ae,g,-w*.26,.47,-d/2+1.5);
    const roof=this.box(w+.4,.25,d+.4,color,this.roofs,x,4.25,z);roof.userData.roof=true;
  }
  batchLand(){
    // Instance repeated static primitives while keeping cutaway roofs separate.
    this.land.updateMatrixWorld(true);const batches=new Map(),remove=[];
    this.land.traverse(o=>{if(!o.isMesh||o.parent===this.roofs||o.material.map)return;const key=o.geometry.type+JSON.stringify(o.geometry.parameters)+':'+o.material.uuid;let b=batches.get(key);if(!b)batches.set(key,b={geometry:o.geometry,material:o.material,matrices:[]});b.matrices.push(o.matrixWorld.clone());remove.push(o);});
    for(const o of remove)o.removeFromParent();
    for(const b of batches.values()){const mesh=new THREE.InstancedMesh(b.geometry,b.material,b.matrices.length);b.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=true;mesh.receiveShadow=true;this.land.add(mesh);}
  }
  location(person,index){const role=person.role.toLowerCase();const district=/student|commut|resident|community/.test(role)?'park':/creator|design|freelance|develop/.test(role)?'workspace':/business|manager|employee|engineer|support|staff/.test(role)?'offices':/shop|customer|subscriber|retail/.test(role)?'market':'park';const n=this.zoneCounts[district]||0;this.zoneCounts[district]=n+1;const centers={workspace:[13,11],market:[-15,7],offices:[-12,-9],park:[13,-9]};const [cx,cz]=centers[district];const columns=6,row=Math.floor(n/columns),column=n%columns;let x=cx+(column-2.5)*1.8,z=cz+(row%5-1.5)*1.55;
    if(district==='park'){x=cx+(column-2.5)*2.1;z=-6.3+(row%3)*1.1;}
    if(row>=5){x=-24+(n%24)*2;z=2.8+Math.floor(row/5)*.55;}
    return {x,z,y:district==='offices'||district==='workspace'?.46:.22,district};
  }
  flyTo(view){const places={overview:{target:[0,0,0],offset:[52,57,65],zoom:1},offices:{target:[-13,1,-9],offset:[17,19,25],zoom:2.65},workspace:{target:[13,1,11],offset:[17,19,25],zoom:2.9},market:{target:[-16,1,11],offset:[18,20,25],zoom:2.6},park:{target:[13,0,-11],offset:[18,22,25],zoom:2.7},top:{target:[0,0,0],offset:[.01,85,.01],zoom:1}};const p=places[view]||places.overview;this.view=view;this.transition={target:new THREE.Vector3(...p.target),position:new THREE.Vector3(...p.target).add(new THREE.Vector3(...p.offset)),zoom:p.zoom};if(this.reduced){this.camera.position.copy(this.transition.position);this.controls.target.copy(this.transition.target);this.camera.zoom=p.zoom;this.transition=null;this.camera.updateProjectionMatrix();}}
  focusPerson(id){const c=this.characters.get(id);if(!c)return;this.transition={target:c.base.clone().add(new THREE.Vector3(0,.8,0)),position:c.base.clone().add(new THREE.Vector3(15,17,23)),zoom:4};}
  toggleInteriors(){this.cutaway=!this.cutaway;this.roofs.visible=!this.cutaway;this.renderer.shadowMap.needsUpdate=true;return this.cutaway;}
  zoomBy(factor){this.transition=null;this.camera.zoom=THREE.MathUtils.clamp(this.camera.zoom*factor,this.controls.minZoom,this.controls.maxZoom);this.camera.updateProjectionMatrix();}
  building(x,z,w,d,h,color,roof,type){const g=new THREE.Group();g.position.set(x,0,z);this.land.add(g);this.box(w,h,d,color,g,0,h/2+.1,0);this.box(w+.3,.22,d+.3,roof,g,0,h+.22,0);for(let i=0;i<3;i++){this.box(.9,1.25,.04,0xa7bec1,g,(i-1)*1.6,1.45,d/2+.025);this.box(.98,.07,.1,0xf7f1e8,g,(i-1)*1.6,.81,d/2+.05);this.box(.04,1.23,.07,0xe9eeea,g,(i-1)*1.6,1.45,d/2+.06);}if(type==='cafe'){for(let i=0;i<10;i++)this.box(w/10,.12,.8,i%2?0xf4e6d5:0xd9997d,g,-w/2+(i+.5)*w/10,2.14,d/2+.3).rotation.x=.12;this.cylinder(.46,.46,.08,0xcbb392,g,0,.87,d/2+1.3);this.cylinder(.055,.09,.8,0x9faaa7,g,0,.42,d/2+1.3);}else{this.box(3,.13,1.45,0xb4c1aa,g,.5,h+.4,0);for(let i=0;i<4;i++)this.sphere(.3,0xa1b28c,g,-.5+i*.62,h+.5,.1);}}
  tree(x,z,s){const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(s);this.land.add(g);this.cylinder(.16,.23,1.6,0xb29a80,g,0,.8,0);this.mesh(new THREE.IcosahedronGeometry(.92,2),0xa8bd9a,g,0,2.06,0);this.mesh(new THREE.IcosahedronGeometry(.7,2),0xb6c9a7,g,.22,2.72,0);this.cylinder(.9,.9,.07,0xdce5d4,g,0,.06,0);}
  bench(x,z,angle){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=angle;this.land.add(g);for(let i=0;i<3;i++)this.box(1.6,.09,.13,0xc8b193,g,0,.65,(i-1)*.17);this.box(1.6,.46,.09,0xd2bc9f,g,0,.95,-.28);for(const dx of [-.6,.6])this.box(.09,.65,.5,0x99a49e,g,dx,.34,0);}
  createCharacter(person,index,total){
    const root=new THREE.Group(),body=new THREE.Group();root.add(body);this.scene.add(root);root.userData.person=person.id;body.userData.person=person.id;
    const i=person.avatar||index,shirt=shirts[i%shirts.length],skin=skinColors[i%skinColors.length],hair=hairs[i%4];
    const torso=this.mesh(new THREE.CapsuleGeometry(.29,.46,6,14),shirt,body,0,1.04,0);torso.scale.z=.73;
    const head=new THREE.Group();head.position.y=1.79;body.add(head);this.sphere(.39,skin,head,0,0,0);this.sphere(.385,hair,head,0,.105,-.065).scale.set(1,.85,1);this.sphere(.1,skin,head,-.365,-.015,0);this.sphere(.1,skin,head,.365,-.015,0);
    this.sphere(.036,0x3c3531,head,-.13,.015,.347);this.sphere(.036,0x3c3531,head,.13,.015,.347);this.sphere(.055,skin,head,0,-.065,.38);const smile=this.mesh(new THREE.TorusGeometry(.085,.012,5,12,Math.PI),0x9c6959,head,0,-.12,.355);smile.rotation.z=Math.PI;
    if(i%4===1){this.mesh(new THREE.CapsuleGeometry(.17,.26,5,10),hair,head,-.29,-.1,-.19);this.mesh(new THREE.CapsuleGeometry(.17,.26,5,10),hair,head,.29,-.1,-.19);}
    if(i%4===2){for(const x of [-.14,.14]){const glasses=this.mesh(new THREE.TorusGeometry(.105,.018,6,18),0x555c60,head,x,.012,.367);glasses.scale.y=.84;}this.box(.06,.02,.025,0x555c60,head,0,.018,.372);}
    if(i%6===3){this.cylinder(.4,.4,.1,0xbca889,head,0,.29,-.02);this.cylinder(.29,.31,.23,0xd7c7a7,head,0,.43,-.05);}
    const arms=[];for(const x of [-.35,.35]){const joint=new THREE.Group();joint.position.set(x,1.26,0);body.add(joint);this.mesh(new THREE.CapsuleGeometry(.105,.38,5,10),shirt,joint,0,-.22,0);this.sphere(.11,skin,joint,0,-.49,0);arms.push(joint);}
    const legs=[];for(const x of [-.16,.16]){const joint=new THREE.Group();joint.position.set(x,.73,0);body.add(joint);this.mesh(new THREE.CapsuleGeometry(.115,.38,5,10),0x64717c,joint,0,-.25,0);this.box(.24,.14,.38,0xf0ece5,joint,0,-.54,.06);legs.push(joint);}
    const ring=this.mesh(new THREE.RingGeometry(.52,.61,48),palette[stance(person.stance)],root,0,.13,0);ring.rotation.x=-Math.PI/2;ring.material=new THREE.MeshBasicMaterial({color:palette[stance(person.stance)],transparent:true,opacity:.6,side:THREE.DoubleSide});ring.castShadow=false;
    const halo=this.mesh(new THREE.RingGeometry(.76,.8,48),0xee794b,root,0,.14,0);halo.rotation.x=-Math.PI/2;halo.material=new THREE.MeshBasicMaterial({color:0xee794b,transparent:true,opacity:.5,side:THREE.DoubleSide});halo.visible=false;
    const el=document.createElement('button');el.className='character-label';el.dataset.person=person.id;el.type='button';const name=document.createElement('span');name.className='character-name';name.textContent=person.name;el.appendChild(name);const bubble=document.createElement('span');bubble.className='character-bubble';el.prepend(bubble);this.labels.appendChild(el);
    const location=this.location(person,index),{x,z,y}=location;root.position.set(x,y,z);body.rotation.y=.5+(index%3)*.18;
    const simple=new THREE.Group();root.add(simple);this.cylinder(.25,.29,.85,shirt,simple,0,.9,0);this.sphere(.34,skin,simple,0,1.65,0);this.box(.4,.5,.28,0x64717c,simple,0,.28,0);simple.userData.person=person.id;
    root.traverse(o=>{if(o.isMesh)o.castShadow=false;});
    return {person,root,body,simple,district:location.district,head,arms,legs,ring,halo,el,name,bubble,base:new THREE.Vector3(x,y,z),target:new THREE.Vector3(x,y,z),phase:index*1.7,action:null,actionTime:-100,decision:null,selected:false};
  }
  setState({worldId,people,edges,selected,active,decisions,round,preview}){
    const changedWorld=this.worldId!==worldId;this.worldId=worldId;if(changedWorld)this.flyTo("overview");
    const key=worldId+':'+people.map(p=>p.id).join(',');
    if(key!==this.lastKey){for(const c of this.characters.values()){this.scene.remove(c.root);c.root.traverse(o=>{o.geometry?.dispose();if(o===c.ring||o===c.halo)o.material.dispose();});c.el.remove();}this.characters.clear();this.zoneCounts={};people.forEach((p,i)=>this.characters.set(p.id,this.createCharacter(p,i,people.length)));this.lastKey=key;}
    this.active=active;this.edges=edges;this.preview=preview;
    const latest=new Map(decisions.map(d=>[d.person_id,d]));
    for(const p of people){const c=this.characters.get(p.id);c.person=p;c.name.textContent=p.name;c.selected=p.id===selected;c.el.classList.toggle('selected',c.selected);c.el.classList.toggle('thinking',p.id===active);c.ring.material.color.setHex(palette[stance(p.stance)]);c.halo.visible=c.selected||p.id===active;
      const d=latest.get(p.id);if(d&&c.decision!==d.id){c.decision=d.id;c.action=d.action;c.actionTime=this.clock.getElapsedTime();c.probability=d.probabilities[d.action];if(d.action==='ASK_PEERS'){const friend=this.characters.get(d.observed[0]);if(friend&&friend.district===c.district&&friend.base.distanceTo(c.base)<6)c.target.copy(c.base).lerp(friend.base,.2);}else c.target.copy(c.base);}
      if(!d){c.action=null;c.decision=null;c.target.copy(c.base);}
      c.el.setAttribute('aria-label',`${p.name}, ${p.role}${p.id===active?', thinking with Jev':d?', '+actions[d.action][1]:''}`);
      if(p.id===active)c.bubble.textContent='✳ Thinking…';else if(d)c.bubble.textContent=`${actions[d.action][0]} ${actions[d.action][1]} · ${d.forced?'forced · ':''}${Math.round(d.probabilities[d.action]*100)}%`;else c.bubble.textContent='';
      c.bubble.classList.toggle('visible',p.id===active||!!d);c.bubble.classList.toggle('opposed',d?.action==='OPPOSE');c.bubble.classList.toggle('supportive',d?.action==='SUPPORT');c.el.classList.toggle('preview',preview);
    }
    this.drawConnections(selected);this.resize();
  }
  drawConnections(selected){for(const child of [...this.connections.children]){this.connections.remove(child);child.geometry.dispose();child.material.dispose();}for(const e of this.edges||[]){if(e.source!==selected&&e.target!==selected)continue;const a=this.characters.get(e.source),b=this.characters.get(e.target);if(!a||!b)continue;const points=[a.base.clone().setY(.16),b.base.clone().setY(.16)];const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:0xbaab97,transparent:true,opacity:.75,dashSize:.16,gapSize:.16}));line.computeLineDistances();this.connections.add(line);}}
  resize(){const width=this.host.clientWidth,height=this.host.clientHeight;if(!width||!height||(width===this.width&&height===this.height))return;this.width=width;this.height=height;this.renderer.setSize(width,height,false);const aspect=width/height,vertical=Math.max(33,47/aspect);this.camera.left=-vertical*aspect;this.camera.right=vertical*aspect;this.camera.top=vertical;this.camera.bottom=-vertical;this.camera.updateProjectionMatrix();}
  reset(){this.flyTo("overview");}
  tick(){const t=this.clock.getElapsedTime(),dt=Math.min(.5,t-(this.lastTick??t));this.lastTick=t;const ease=1-Math.exp(-dt*7);
    if(this.transition){const tr=this.transition;this.camera.position.lerp(tr.position,ease);this.controls.target.lerp(tr.target,ease);this.camera.zoom=THREE.MathUtils.lerp(this.camera.zoom,tr.zoom,ease);this.camera.updateProjectionMatrix();if(this.camera.position.distanceTo(tr.position)<.02&&Math.abs(this.camera.zoom-tr.zoom)<.005)this.transition=null;}
    this.controls.update();
    for(const car of this.cars){const v=((this.reduced?0:t*.9)+car.phase*200)%200;let x,z,angle;if(v<56){x=-30+v;z=-22;angle=0;}else if(v<100){x=26;z=-22+(v-56);angle=-Math.PI/2;}else if(v<156){x=26-(v-100);z=22;angle=Math.PI;}else{x=-30;z=22-(v-156);angle=Math.PI/2;}car.group.position.set(x,0,z);car.group.rotation.y=angle;}
    for(const district of this.cityLabels){const p=district.position.clone().project(this.camera);district.el.style.transform=`translate(${(p.x+1)/2*this.width}px,${(1-p.y)/2*this.height}px) translate(-50%,-50%)`;district.el.style.display=this.camera.zoom>1.9||Math.abs(p.x)>1||Math.abs(p.y)>1?'none':'';}
    const close=new Set(this.camera.zoom>1.65?[...this.characters.values()].sort((a,b)=>a.base.distanceToSquared(this.controls.target)-b.base.distanceToSquared(this.controls.target)).slice(0,10):[]);
    for(const c of this.characters.values()){
      const detailed=close.has(c)||c.selected||c.person.id===this.active;c.body.visible=detailed;c.simple.visible=!detailed;

      const age=t-c.actionTime,acting=age<5&&!this.reduced,walking=c.root.position.distanceTo(c.target)>.05&&!this.reduced;
      c.root.position.lerp(c.target,.035);c.body.position.y=this.reduced?0:Math.sin(t*2+c.phase)*.018;
      c.head.rotation.y=this.reduced?0:Math.sin(t*.6+c.phase)*.1;c.arms[0].rotation.set(0,0,.08);c.arms[1].rotation.set(0,0,-.08);c.legs.forEach(l=>l.rotation.x=0);
      if(walking){c.legs[0].rotation.x=Math.sin(t*9)*.38;c.legs[1].rotation.x=-Math.sin(t*9)*.38;c.arms[0].rotation.x=-Math.sin(t*9)*.3;c.arms[1].rotation.x=Math.sin(t*9)*.3;}
      else if(acting&&c.action==='SUPPORT'){c.arms[1].rotation.z=2.4+Math.sin(t*9)*.2;c.body.position.y+=Math.abs(Math.sin(t*5))*.06;}
      else if(acting&&c.action==='ADVOCATE'){c.arms[0].rotation.z=-1.35+Math.sin(t*5)*.18;c.arms[1].rotation.z=1.35-Math.sin(t*5)*.18;}
      else if(c.action==='OPPOSE'){c.arms[0].rotation.set(-.75,0,-.6);c.arms[1].rotation.set(-.8,0,.6);if(acting)c.head.rotation.y=Math.sin(t*6)*.2;}
      else if(acting&&c.action==='ASK_PEERS'){c.arms[0].rotation.z=-1.1;c.head.rotation.y=Math.sin(t*3)*.2;}
      if(c.person.id===this.active){c.arms[1].rotation.x=-1.3;c.arms[1].rotation.z=.65;c.halo.scale.setScalar(1+Math.sin(t*4)*.07);c.halo.material.opacity=.35+Math.sin(t*4)*.18;}else{c.halo.scale.setScalar(1);c.halo.material.opacity=.6;}
      const pos=c.root.position.clone().add(new THREE.Vector3(0,2.5,0)).project(this.camera),x=(pos.x+1)/2*this.width,y=(1-pos.y)/2*this.height;
      c.el.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;c.el.style.zIndex=String(Math.round((1-pos.z)*100));const showName=c.selected||c.person.id===this.active||this.camera.zoom>2.2;c.el.style.display=!showName||pos.z>1||Math.abs(pos.x)>1.05||Math.abs(pos.y)>1.1?'none':'';c.ring.visible=detailed;c.halo.visible=c.selected||c.person.id===this.active;
      c.bubble.classList.toggle('quiet',!c.selected&&c.person.id!==this.active&&age>8);
    }this.renderer.render(this.scene,this.camera);}
}
window.WorldStage=WorldStage;window.dispatchEvent(new Event('worldstage-ready'));
