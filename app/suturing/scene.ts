import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { StitchFrame, StitchMotion, Vec3 } from "./types";

function detailMap(cloth = false) {
  const n=512, bytes=new Uint8Array(n*n*4); let seed=613;
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const grain=seed/4294967296;
    const pore=Math.pow(grain,14)*80;
    const value=cloth ? 160+25*Math.sin(x*2)*Math.cos(y*2)+grain*15 : 175+16*Math.sin(x*.11)*Math.cos(y*.15)+grain*24-pore;
    const k=4*(y*n+x); bytes[k]=bytes[k+1]=bytes[k+2]=value; bytes[k+3]=255;
  }
  const texture=new T.DataTexture(bytes,n,n); texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.generateMipmaps=true; texture.minFilter=T.LinearMipmapLinearFilter; texture.needsUpdate=true;
  texture.repeat.setScalar(cloth?8:3); texture.anisotropy=8; return texture;
}
function line(points: number[][], radius: number, material: T.Material, segments=48) {
  const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3().fromArray(p)));
  const mesh=new T.Mesh(new T.TubeGeometry(curve,segments,radius,8,false),material);
  mesh.castShadow=true; mesh.receiveShadow=true; return mesh;
}
function rod(a:number[],b:number[],radius:number,material:T.Material) {
  const start=new T.Vector3().fromArray(a),end=new T.Vector3().fromArray(b),d=end.clone().sub(start);
  const m=new T.Mesh(new T.CylinderGeometry(radius,radius,d.length(),16),material);
  m.position.copy(start).add(end).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()); m.castShadow=true; return m;
}

function forceps(steel:T.Material,accent:T.Material) {
  const root=new T.Group(), tips:T.Group[]=[];
  for(const sign of [-1,1]) {
    const tip=new T.Group(); root.add(tip); tips.push(tip);
    const jaw=new T.Mesh(new RoundedBoxGeometry(.0035,.004,.0014,3,.0003),steel); jaw.castShadow=true; tip.add(jaw);
    for(let i=0;i<7;i++) {
      const tooth=new T.Mesh(new T.BoxGeometry(.00018,.00025,.001),accent);
      tooth.position.set((i-3)*.00046,-sign*.002,0); tip.add(tooth);
    }
    root.add(line([[0,sign*.003,0],[sign*.003,-.014,.002],[sign*.004,-.04,.007],[sign*.009,-.067,.009]],.0011,steel));
    const ring=new T.Mesh(new T.TorusGeometry(.007,.0012,12,56),steel);
    ring.position.set(sign*.009,-.074,.01); ring.scale.y=1.28; ring.castShadow=true; root.add(ring);
  }
  const hinge=new T.Mesh(new T.CylinderGeometry(.0024,.0024,.0014,24),accent);
  hinge.rotation.x=Math.PI/2; hinge.position.set(0,-.024,.003); root.add(hinge);
  return {root,update(closure:number){tips[0].position.y=-(.0022+.0025*(1-closure));tips[1].position.y=.0022+.0025*(1-closure);}};
}

export function surgicalScene(motion:StitchMotion,onTextureReady:()=>void) {
  const root=new T.Group(); const [cx,cy,z]=motion.scene.center;
  const pores=detailMap(),fabricMap=detailMap(true);
  const skin=new T.MeshPhysicalMaterial({color:0xffffff,vertexColors:true,roughness:.49,bumpMap:pores,bumpScale:.00009,
    clearcoat:.2,clearcoatRoughness:.42,sheen:.2,sheenColor:new T.Color("#ad5043"),sheenRoughness:.75,side:T.DoubleSide});
  const photoDetail=new T.TextureLoader().load('/models/stitch/skin-detail.jpg',onTextureReady);
  photoDetail.colorSpace=T.SRGBColorSpace;photoDetail.wrapS=photoDetail.wrapT=T.RepeatWrapping;photoDetail.repeat.set(2,3);photoDetail.anisotropy=8;skin.map=photoDetail;
  const wound=new T.MeshPhysicalMaterial({color:"#913f40",roughness:.35,clearcoat:.6,clearcoatRoughness:.22,bumpMap:pores,bumpScale:.00015,side:T.DoubleSide});
  const steel=new T.MeshPhysicalMaterial({color:"#c3cbcd",metalness:1,roughness:.23,anisotropy:.6,clearcoat:.25});
  const darkSteel=new T.MeshStandardMaterial({color:"#626f76",metalness:.95,roughness:.4});
  const threadMat=new T.MeshPhysicalMaterial({color:"#303d50",roughness:.48,clearcoat:.3});
  const patches:{mesh:T.Mesh;sign:number;uv:Float32Array}[]=[];
  for(const sign of [-1,1]) {
    const geo=new T.PlaneGeometry(1,1,72,112); const pos=geo.attributes.position;
    const uv=new Float32Array(pos.count*2),colors=new Float32Array(pos.count*3);
    for(let i=0;i<pos.count;i++) {
      const u=pos.getX(i)+.5, v=pos.getY(i)+.5; uv[2*i]=u;uv[2*i+1]=v;
      const edge=Math.exp(-u*45)*Math.pow(Math.max(0,1-Math.pow((v-.5)*.18/.043,2)),.4);
      const c=new T.Color("#ce9b83").lerp(new T.Color("#ac5250"),edge*.7);
      const mottling=.97+.03*Math.sin(u*90+v*21)*Math.cos(v*80); c.multiplyScalar(mottling);
      colors.set([c.r,c.g,c.b],i*3);
    }
    geo.setAttribute("color",new T.BufferAttribute(colors,3));
    const mesh=new T.Mesh(geo,skin);mesh.name=sign<0?'pad_left':'pad_right'; mesh.receiveShadow=true;mesh.castShadow=true;root.add(mesh); patches.push({mesh,sign,uv});
  }
  const walls=[-1,1].map(sign=>{
    const geo=new T.PlaneGeometry(1,1,1,96),mesh=new T.Mesh(geo,wound);root.add(mesh);return{mesh,sign};
  });
  const support=new T.Mesh(new RoundedBoxGeometry(.47,.55,.055,5,.025),new T.MeshStandardMaterial({color:"#16414a",roughness:.95}));
  support.visible=false;
  support.position.set(cx,cy,z-.038); support.receiveShadow=true;root.add(support);
  const bed=new T.Mesh(new RoundedBoxGeometry(.52,.62,.022,4,.012),steel);bed.position.set(cx,cy,z-.078);bed.visible=false;root.add(bed);
  // Gauze and a parked instrument give the close view scale without obscuring the bite.
  const gauzeMaterial=new T.MeshStandardMaterial({color:"#e8e2cd",roughness:1,bumpMap:fabricMap,bumpScale:.0003});
  for(let i=0;i<3;i++) {const gauze=new T.Mesh(new RoundedBoxGeometry(.037,.028,.0012,2,.001),gauzeMaterial);gauze.position.set(cx+.064,cy+.108,z+.0006+i*.0012);gauze.rotation.z=.2+i*.035;gauze.castShadow=true;root.add(gauze);}
  root.add(rod([cx-.07,cy+.107,z],[cx+.009,cy+.12,z],.0015,steel));
  const needleRoot=new T.Group();needleRoot.name='needle';root.add(needleRoot);
  const arc=Array.from({length:65},(_,i)=>{const a=-Math.PI+i/64*Math.PI;return[motion.scene.radius*Math.cos(a),0,motion.scene.radius*Math.sin(a)];});
  const needle=line(arc,.00043,steel,128);needleRoot.add(needle);
  // Taper the distal end while preserving the measured circle and tip location.
  const ng=needle.geometry as T.TubeGeometry; const np=ng.attributes.position;
  for(let i=0;i<np.count;i++) {const u=Math.floor(i/9)/128;if(u>.92){const a=-Math.PI+u*Math.PI,c=new T.Vector3(motion.scene.radius*Math.cos(a),0,motion.scene.radius*Math.sin(a)),p=new T.Vector3().fromBufferAttribute(np,i).sub(c).multiplyScalar(Math.max(.04,(1-u)/.08)).add(c);np.setXYZ(i,p.x,p.y,p.z);}}
  ng.computeVertexNormals();
  const donor=forceps(steel,darkSteel),receiver=forceps(steel,darkSteel);donor.root.name='donor';receiver.root.name='receiver';root.add(donor.root,receiver.root);
  const filament=line([[0,0,0],[.01,0,0]],.00016,threadMat,72);root.add(filament);
  const bridge=line([[0,0,0],[.01,0,0]],.00018,threadMat,48);root.add(bridge);
  let previousGap=-1;
  function deform(gap:number) {
    if(Math.abs(gap-previousGap)<1e-8)return;previousGap=gap;
    for(const {mesh,sign,uv} of patches) {
      const p=mesh.geometry.attributes.position;
      for(let i=0;i<p.count;i++) {
        const u=uv[2*i],y=(uv[2*i+1]-.5)*.18;
        const shape=Math.sqrt(Math.max(0,1-(y/.043)**2));
        const edge=gap*.5*shape;
        const x=sign*(edge+u*(.092-edge));
        const lip=.00035*Math.exp(-u*60)*shape;
        p.setXYZ(i,cx+x,cy+y,z+lip-.005*(x/.1)**4);
      }
      p.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
    for(const {mesh,sign} of walls) {
      const p=mesh.geometry.attributes.position;
      for(let i=0;i<p.count;i++) {
        const row=Math.floor(i/2),y=(.5-row/96)*.086,shape=Math.sqrt(Math.max(0,1-(y/.043)**2));
        const bottom=i%2===0;
        p.setXYZ(i,cx+sign*(bottom?.00005:gap*.5*shape),cy+y,bottom?z-.013*shape:z+.00035*shape);
      }p.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
  }
  function updateTube(mesh:T.Mesh,points:Vec3[],segments:number) {
    const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3().fromArray(p)));
    const frames=curve.computeFrenetFrames(segments,false),p=mesh.geometry.attributes.position;
    for(let i=0;i<=segments;i++) {const center=curve.getPointAt(i/segments);for(let j=0;j<=8;j++) {const a=j/8*Math.PI*2,v=center.clone().addScaledVector(frames.normals[i],Math.cos(a)*.00016).addScaledVector(frames.binormals[i],Math.sin(a)*.00016);p.setXYZ(i*9+j,v.x,v.y,v.z);}}
    p.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
  }
  return {root,update(f:StitchFrame){
    deform(f.gap_m);needleRoot.position.fromArray(f.center);needleRoot.quaternion.setFromAxisAngle(new T.Vector3(0,-1,0),f.theta);
    donor.root.position.fromArray(f.jaws[0]);receiver.root.position.fromArray(f.jaws[1]);donor.update(f.closure[0]);receiver.update(f.closure[1]);
    filament.visible=f.entered;bridge.visible=f.needle_clear;
    if(f.entered){const a=f.exited?f.anchors[1]:f.anchors[0],b=f.tail;updateTube(filament,[a,[(a[0]+b[0])*.5,(a[1]+b[1])*.5-.002,Math.max(a[2],b[2])+.002*(1-Math.min(1,f.tension_n/.3))],b],72);}
    if(f.needle_clear){const a=f.anchors[0],b=f.anchors[1];updateTube(bridge,[a,[(a[0]+b[0])/2,cy,z+.00065],b],48);}
  }};
}
