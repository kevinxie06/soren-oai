import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { operatingRoom } from "../showcase/operating-room";
import type { StitchMotion, Vec3 } from "./types";

export function disposeTree(root:T.Object3D){
  const textures=new Set<T.Texture>(),materials=new Set<T.Material>(),geometries=new Set<T.BufferGeometry>();
  root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v instanceof T.Texture)textures.add(v);}}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
}
type RobotFrame={nodes:{name:string;position:Vec3;quaternion_xyzw:[number,number,number,number]}[];hand_position:Vec3};

export function roomContext(motion:StitchMotion,ready:()=>void,status:(message:string)=>void,cancelled:()=>boolean){
  const root=operatingRoom({sample_hz:motion.sample_hz,duration_s:motion.duration_s,toolPath:motion.frames.map(f=>f.center)});
  root.name='operating_room';let robot:T.Group|null=null,frames:RobotFrame[]=[];
  const carrier=new T.Group();carrier.name='presentation_tool_carrier';carrier.visible=false;root.add(carrier);
  const carrierMaterial=new T.MeshStandardMaterial({color:'#87949b',metalness:.85,roughness:.3});
  const struts=Array.from({length:3},()=>{const m=new T.Mesh(new T.CylinderGeometry(.0018,.0018,1,16),carrierMaterial);m.castShadow=true;carrier.add(m);return m;});
  const nodes=new Map<string,T.Object3D>();
  const loader=new GLTFLoader(),textures=new T.TextureLoader();
  Promise.allSettled([
    loader.loadAsync('/models/patient/LeePerrySmith.glb'),
    textures.loadAsync('/models/patient/Map-COL.jpg'),
    textures.loadAsync('/models/patient/Infinite-Level_02_Tangent_SmoothUV.jpg'),
    loader.loadAsync('/models/robot/panda.glb'),
    fetch(motion.presentation_assets?.robot_fit ?? '/motion/stitch-robot.json').then(r=>{if(!r.ok)throw new Error('Suturing robot fit unavailable');return r.json() as Promise<{frames:RobotFrame[];seed:number;checkpoint_sha256:string}>;}),
  ]).then(results=>{
    const errors=results.filter(r=>r.status==='rejected');
    if(cancelled()||errors.length){
      results.forEach((r,i)=>{if(r.status==='fulfilled'&&i<4){if(r.value instanceof T.Texture)r.value.dispose();else if ("scene" in r.value) disposeTree(r.value.scene);}});
      if(!cancelled())status('Patient/robot assets unavailable. Reload to retry.');return;
    }
    const head=(results[0] as PromiseFulfilledResult<Awaited<ReturnType<GLTFLoader['loadAsync']>>>).value;
    const color=(results[1] as PromiseFulfilledResult<T.Texture>).value,normal=(results[2] as PromiseFulfilledResult<T.Texture>).value;
    const panda=(results[3] as PromiseFulfilledResult<Awaited<ReturnType<GLTFLoader['loadAsync']>>>).value;
    const fit=(results[4] as PromiseFulfilledResult<{frames:RobotFrame[];seed:number;checkpoint_sha256:string}>).value;
    if(fit.seed!==motion.scene.seed||fit.checkpoint_sha256!==motion.result.checkpoint_sha256||fit.frames.length!==motion.frames.length){
      disposeTree(head.scene);disposeTree(panda.scene);color.dispose();normal.dispose();status('Robot fit does not match this recording. Rebuild the suturing presentation.');return;
    }
    color.colorSpace=T.SRGBColorSpace;color.flipY=normal.flipY=true;color.anisotropy=normal.anisotropy=8;
    const skin=new T.MeshPhysicalMaterial({map:color,normalMap:normal,normalScale:new T.Vector2(.65,.65),roughness:.52,clearcoat:.12,clearcoatRoughness:.6});
    head.scene.traverse(o=>{if(o instanceof T.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();o.material=skin;o.castShadow=o.receiveShadow=true;}});
    head.scene.name='scanned_patient_head';head.scene.scale.setScalar(.036);head.scene.position.set(0,.565,-.027);root.add(head.scene);
    robot=panda.scene;robot.name='suturing_panda';frames=fit.frames;carrier.visible=true;
    robot.traverse(o=>{nodes.set(o.name,o);if(o instanceof T.Mesh)o.castShadow=o.receiveShadow=true;});root.add(robot);
    // Never start the GLB's heart animation; only apply this recording's fitted transforms.
    update(0);status('Scanned patient · articulated robot · suturing motion');ready();
  }).catch(e=>{if(!cancelled())status(`Room assets failed: ${String(e)}`);});
  function update(time:number){
    if(!robot||!frames.length)return;
    const index=Math.min(frames.length-1,Math.max(0,time*motion.sample_hz)),a=Math.floor(index),b=Math.min(a+1,frames.length-1),t=index-a;
    frames[a].nodes.forEach((n,i)=>{const node=nodes.get(n.name);if(!node)return;const next=frames[b].nodes[i];
      node.position.fromArray(n.position).lerp(new T.Vector3().fromArray(next.position),t);
      node.quaternion.fromArray(n.quaternion_xyzw).slerp(new T.Quaternion().fromArray(next.quaternion_xyzw),t);
    });
    const f=motion.frames[a],next=motion.frames[b],c=new T.Vector3().fromArray(f.center).lerp(new T.Vector3().fromArray(next.center),t);
    const hub=c.clone().add(new T.Vector3(0,-.10,.035)),top=c.clone().add(new T.Vector3(0,-.10,.075));
    const ends=f.jaws.map((p,i)=>new T.Vector3().fromArray(p).lerp(new T.Vector3().fromArray(next.jaws[i]),t).add(new T.Vector3(0,-.074,.01)));
    [[hub,top],[hub,ends[0]],[hub,ends[1]]].forEach(([start,end],i)=>{const d=end.clone().sub(start);struts[i].position.copy(start).add(end).multiplyScalar(.5);struts[i].scale.y=d.length();struts[i].quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());});
  }
  return {root,update};
}
