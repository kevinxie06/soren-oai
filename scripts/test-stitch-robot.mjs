import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent??=class{constructor(type,init){this.type=type;Object.assign(this,init);}};
const old=process.argv.includes('--old');
const raw=await readFile(old?'public/motion/stitch-old.json':'public/motion/stitch.json'),motion=JSON.parse(raw);
const fit=JSON.parse(await readFile(old?'public/motion/stitch-old-robot.json':'public/motion/stitch-robot.json','utf8'));
assert.equal(fit.source_sha256,createHash('sha256').update(raw).digest('hex'));
const file=await readFile('public/models/robot/panda.glb');
const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
const hand=gltf.scene.getObjectByName('hand');assert.ok(hand);let maximum=0;
for(const index of [...motion.frames.keys(),...Array.from(motion.frames.keys()).reverse()]){
 for(const node of fit.frames[index].nodes){const obj=gltf.scene.getObjectByName(node.name);assert.ok(obj);obj.position.fromArray(node.position);obj.quaternion.fromArray(node.quaternion_xyzw);}
 gltf.scene.updateMatrixWorld(true);
 const target=new T.Vector3().fromArray(motion.frames[index].center).add(new T.Vector3().fromArray(fit.carrier_offset_m));
 maximum=Math.max(maximum,hand.getWorldPosition(new T.Vector3()).distanceTo(target));
}
assert.ok(maximum<.00001);assert.ok(fit.joint_limits_satisfied);
console.log(`Suturing robot passed ${motion.frames.length} states forward/backward; maximum hand fit error ${maximum*1000} mm. No heart animation used.`);
