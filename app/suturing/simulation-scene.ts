import * as T from 'three';
import type { StitchFrame, StitchMotion } from './types';

export function simulationScene(motion:StitchMotion){
  const root=new T.Group();root.name='simulation_geometry';
  const objects=motion.geometry.map(g=>{
    const s=g.half_size_m;
    const geo=g.shape==='box'?new T.BoxGeometry(2*s[0],2*s[1],2*s[2]):g.shape==='capsule'?new T.CapsuleGeometry(s[0],2*s[1],4,12):g.shape==='plane'?new T.PlaneGeometry(2*s[0],2*s[1]):new T.SphereGeometry(s[0],16,12);
    if(g.shape==='capsule')geo.rotateX(Math.PI/2);
    const m=new T.Mesh(geo,new T.MeshStandardMaterial({color:new T.Color(g.rgba[0],g.rgba[1],g.rgba[2]),roughness:.6,transparent:g.rgba[3]<1,opacity:g.rgba[3]}));
    m.name=g.name;m.castShadow=g.shape!=='plane';m.receiveShadow=true;root.add(m);return m;
  });
  const thread=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(),new T.Vector3()]),new T.LineBasicMaterial({color:'#18232e'}));root.add(thread);
  return{root,update(f:StitchFrame){objects.forEach((m,i)=>{const p=f.poses[i],q=p.quaternion_wxyz;m.position.fromArray(p.position_m);m.quaternion.set(q[1],q[2],q[3],q[0]);});thread.visible=f.needle_clear;thread.geometry.setFromPoints(f.anchors.map(p=>new T.Vector3().fromArray(p)));}};
}
