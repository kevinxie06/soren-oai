"use client";
import { useEffect, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { NavigationMode } from "../camera-controls";
import { surgicalScene } from "./scene";
import { roomContext, disposeTree } from "./room-context";
import { simulationScene } from "./simulation-scene";
import type { StitchFrame, StitchMotion, Vec3 } from "./types";

export default function Viewer({motion,time,angle,navigation="orbit",geometry=false,asset,onStatus}:{motion:StitchMotion;time:number;angle:string;navigation?:NavigationMode;geometry?:boolean;asset:{data:ArrayBuffer;name:string}|null;onStatus:(message:string)=>void}) {
  const navigationRef=useRef(navigation);
  useEffect(()=>{navigationRef.current=navigation;},[navigation]);
  const host=useRef<HTMLDivElement>(null),cursor=useRef(time),view=useRef(angle);const [error,setError]=useState("");
  useEffect(()=>{cursor.current=time;},[time]);useEffect(()=>{view.current=angle;},[angle]);
  useEffect(()=>{
    const el=host.current;if(!el)return;let cleanup=()=>{},cancelled=false;
    Promise.resolve().then(()=>{
      if(cancelled)return;
      const renderer=new T.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;el.appendChild(renderer.domElement);
      const scene=new T.Scene();scene.background=new T.Color(geometry?'#142428':'#91a7a8');scene.fog=new T.Fog(geometry?'#142428':'#91a7a8',6,12);
      const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room);scene.environment=env.texture;scene.environmentIntensity=.65;pmrem.dispose();room.dispose();
      let dirty=true;
      const surgical=geometry?simulationScene(motion):surgicalScene(motion,()=>{dirty=true;});scene.add(surgical.root);
      onStatus(geometry?'Measured MuJoCo geometry':'Loading patient and robot…');
      const context=geometry?null:roomContext(motion,()=>{lastTime=-1;dirty=true;},message=>{if(!asset)onStatus(message);},()=>cancelled);
      if(context)scene.add(context.root);
      const bindings:{anchor:T.Group;name:string;index:number}[]=[];
      if(!geometry&&asset){new GLTFLoader().parseAsync(asset.data,'').then(gltf=>{
        if(cancelled){disposeTree(gltf.scene);return;}
        const animated:T.Object3D[]=[];gltf.scene.traverse(o=>{if(o.name.startsWith('motion__'))animated.push(o);if(o instanceof T.Mesh)o.castShadow=o.receiveShadow=true;});scene.add(gltf.scene);
        for(const object of animated){const name=object.name.slice(8),index=motion.geometry.findIndex(g=>g.name===name);
          if(index<0&&!['needle','donor','receiver'].includes(name))continue;
          const anchor=new T.Group();scene.add(anchor);anchor.add(object);bindings.push({anchor,name,index});
          const original=surgical.root.getObjectByName(name);if(original)original.visible=false;
          if(Array.isArray(object.userData.replaces))for(const replaced of object.userData.replaces){const old=surgical.root.getObjectByName(replaced);if(old)old.visible=false;}
        }
        if(context)context.root.visible=false;lastTime=-1;dirty=true;onStatus(`${asset.name} · ${bindings.length} motion bindings`);
      }).catch(e=>{if(!cancelled)onStatus(`Model could not load: ${String(e)}`);});}
      scene.add(new T.HemisphereLight("#e6f4ff","#443138",.65));
      const key=new T.DirectionalLight("#fff0dc",2);key.position.set(.2,-.3,1.8);key.castShadow=true;key.shadow.mapSize.set(2048,2048);
      Object.assign(key.shadow.camera,{left:-.17,right:.17,top:.17,bottom:-.17,near:.01,far:1});key.shadow.normalBias=.00015;key.shadow.bias=-.00003;key.shadow.radius=3;scene.add(key);
      const rim=new T.DirectionalLight("#c6e8ff",1);rim.position.set(.1,.1,.12);scene.add(rim);
      const camera=new T.PerspectiveCamera(36,1,.001,15);camera.up.set(0,0,1);
      const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.04;controls.maxDistance=8;controls.maxPolarAngle=Math.PI*.88;
      const composer=new EffectComposer(renderer),ao=new SSAOPass(scene,camera,512,512);
      ao.kernelRadius=.006;ao.minDistance=.00008;ao.maxDistance=.015;composer.addPass(new RenderPass(scene,camera));composer.addPass(ao);composer.addPass(new OutputPass());composer.addPass(new FXAAPass());
      const resize=new ResizeObserver(()=>{const{width,height}=el.getBoundingClientRect();renderer.setSize(width,height);composer.setSize(width,height);camera.aspect=width/Math.max(height,1);camera.updateProjectionMatrix();dirty=true;});resize.observe(el);
      let id=0,lastView="",lastTime=-1;
      const lerpVec=(a:Vec3,b:Vec3,t:number)=>a.map((v,i)=>T.MathUtils.lerp(v,b[i],t)) as Vec3;
      function draw(){
        controls.mouseButtons.LEFT=navigationRef.current==='pan'?T.MOUSE.PAN:T.MOUSE.ROTATE;
        controls.touches.ONE=navigationRef.current==='pan'?T.TOUCH.PAN:T.TOUCH.ROTATE;
        renderer.domElement.dataset.navigation=navigationRef.current;
        if(lastView!==view.current){lastView=view.current;dirty=true;const c=motion.scene.center;
          const offsets:Record<string,Vec3>={room:[-2.2,-2.8,1.9],patient:[.38,.91,.4],macro:[.055,-.078,.080],overhead:[0,-.002,.18],field:[-.48,-.56,.58]};
          camera.position.fromArray(c).add(new T.Vector3().fromArray(offsets[lastView]??offsets.room));
          camera.fov=lastView==='room'?45:36;camera.updateProjectionMatrix();
          controls.target.set(c[0],lastView==='patient'?.48:c[1]-.012,lastView==='room'?.2:c[2]);controls.update();
          renderer.domElement.dataset.camera=lastView;
          const wide=['room','patient','field'].includes(lastView),extent=wide?2:.17;
          Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,far:8});key.shadow.camera.updateProjectionMatrix();key.shadow.normalBias=wide?.001:.00015;
          ao.kernelRadius=wide?.055:.006;
        }
        if(lastTime!==cursor.current){lastTime=cursor.current;dirty=true;const index=Math.max(0,Math.min(motion.frames.length-1,cursor.current*motion.sample_hz)),a=Math.floor(index),b=Math.min(a+1,motion.frames.length-1),t=index-a;
          const x=motion.frames[a],y=motion.frames[b];
          const frame:StitchFrame={...x,center:lerpVec(x.center,y.center,t),theta:T.MathUtils.lerp(x.theta,y.theta,t),tip:lerpVec(x.tip,y.tip,t),tail:lerpVec(x.tail,y.tail,t),
            jaws:x.jaws.map((v,i)=>lerpVec(v,y.jaws[i],t)),anchors:x.anchors.map((v,i)=>lerpVec(v,y.anchors[i],t)),closure:x.closure.map((v,i)=>T.MathUtils.lerp(v,y.closure[i],t)),gap_m:T.MathUtils.lerp(x.gap_m,y.gap_m,t),tension_n:T.MathUtils.lerp(x.tension_n,y.tension_n,t),
            poses:x.poses.map((p,i)=>{const q=p.quaternion_wxyz,r=y.poses[i].quaternion_wxyz,result=new T.Quaternion(q[1],q[2],q[3],q[0]).slerp(new T.Quaternion(r[1],r[2],r[3],r[0]),t);return{position_m:lerpVec(p.position_m,y.poses[i].position_m,t),quaternion_wxyz:[result.w,result.x,result.y,result.z]};})};
          surgical.update(frame);renderer.domElement.dataset.time=String(cursor.current);renderer.domElement.dataset.gap=String(frame.gap_m);
          context?.update(cursor.current);
          for(const {anchor,name,index} of bindings){
            if(name==='needle'){anchor.position.fromArray(frame.center);anchor.quaternion.setFromAxisAngle(new T.Vector3(0,-1,0),frame.theta);}
            else if(name==='donor'||name==='receiver'){anchor.position.fromArray(frame.jaws[name==='donor'?0:1]);anchor.quaternion.identity();}
            else{const p=frame.poses[index],q=p.quaternion_wxyz;anchor.position.fromArray(p.position_m);anchor.quaternion.set(q[1],q[2],q[3],q[0]);}
          }
        }
        const moved=controls.update();if(dirty||moved){composer.render();dirty=false;}id=requestAnimationFrame(draw);
      }draw();
      cleanup=()=>{cancelAnimationFrame(id);resize.disconnect();controls.dispose();disposeTree(scene);key.shadow.dispose();composer.passes.forEach(p=>p.dispose());composer.dispose();env.dispose();renderer.dispose();renderer.domElement.remove();};
    }).catch(e=>{if(!cancelled)setError(String(e));});
    return()=>{cancelled=true;cleanup();};
  },[motion,geometry,asset,onStatus]);
  return <div className="stitch-canvas" ref={host} role="img" aria-label="Three-dimensional playback of the learned suturing policy">{error&&<p role="alert">3D view unavailable: {error}. The original simulation video remains available.</p>}</div>;
}
