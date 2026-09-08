"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { operatingRoom } from "./operating-room";
import { operativeDetails, presentationHeart } from "./surgical-detail";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import CameraControls, { type CameraView, type NavigationMode } from "../camera-controls";
import { recordedHeartGripper, recordedRobot } from "../robot-motion";
import { createScenarioGuides, type ScenarioGuide } from "../scenario-guides";
import type { Motion } from "./types";

export default function MotionView({ motion, time, context, initialView, onCapture, guide }: { motion: Motion; time: number; context: boolean; initialView?: CameraView; onCapture?: (url: string) => void; guide?: ScenarioGuide }) {
  const [angle,setAngle] = useState<CameraView>(context ? "room" : "macro");
  const [navigation,setNavigation] = useState<NavigationMode>("orbit");
  const navigationRef=useRef(navigation);
  useEffect(()=>{navigationRef.current=navigation;},[navigation]);
  const capture = useRef(onCapture);
  useEffect(() => { capture.current = onCapture; }, [onCapture]);
  const host = useRef<HTMLDivElement>(null);
  const cursor = useRef(time);
  const [error, setError] = useState("");
  const [bundledStatus, setBundledStatus] = useState("Loading patient and robot…");
  const cameraView = useRef<(view: CameraView) => void>(() => {});
  useEffect(() => { cursor.current = time; }, [time]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let dispose = () => {};
    // Defer initialization so context creation failures become a visible fallback.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      let dirty = true, lastTime = -1;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = .9;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      if (guide) scene.add(createScenarioGuides(motion, guide));
      scene.background = new THREE.Color(context ? "#91a7a8" : "#101d29");
      const pmrem = new THREE.PMREMGenerator(renderer);
      const environmentScene = new RoomEnvironment();
      const environment = pmrem.fromScene(environmentScene);
      scene.environment = environment.texture; scene.environmentIntensity = .45;
      environmentScene.dispose(); pmrem.dispose();
      const camera = new THREE.PerspectiveCamera(40, 1, .005, 15);
      camera.up.set(0, 0, 1);
      camera.position.set(.95, -.95, .9);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(.09, .09, .015);
      controls.enableDamping = true;
      controls.minDistance = .04; controls.maxDistance = 8;
      controls.maxPolarAngle = Math.PI * .88;
      cameraView.current = (view) => {
        dirty = true;
        const heartIndex=motion.geometry.findIndex(g=>g.name==='object_collision');
        const center=heartIndex>=0?motion.frames[0].poses[heartIndex].position_m:[0,0,.025];
        const positions = { room: [-2.2, -2.8, 1.9], field: [-.48, -.56, .58], patient: [.38, .91, .4], macro: [center[0]+.14,center[1]-.20,center[2]+.16], overhead: [center[0],center[1]-.002,center[2]+.48] };
        camera.position.fromArray(positions[view]);
        camera.fov=view==='room'?45:36;camera.updateProjectionMatrix();
        if(view==='macro'||view==='overhead')controls.target.fromArray(center);
        else controls.target.set(.05, view === "patient" ? .48 : -.02, view === "room" ? .2 : .025);
        controls.update();renderer.domElement.dataset.camera=view;
      };
      const startingView=initialView ?? (context?'room':'macro');setAngle(startingView);cameraView.current(startingView);
      scene.add(new THREE.HemisphereLight(0xdaefff, 0x536576, .65));
      const light = new THREE.DirectionalLight(0xffffff, 1.5);
      light.position.set(.2, -.3, 1.8); light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.left = -2; light.shadow.camera.right = 2;
      light.shadow.camera.top = 2; light.shadow.camera.bottom = -2;
      light.shadow.camera.near = .01; light.shadow.camera.far = 8;
      light.shadow.normalBias = .001; scene.add(light);
      function mesh(shape: string, size: number[], color: THREE.ColorRepresentation) {
        const geometry = shape === "box" ? new THREE.BoxGeometry(2 * size[0], 2 * size[1], 2 * size[2])
          : shape === "plane" ? new THREE.PlaneGeometry(2 * size[0], 2 * size[1]) : new THREE.SphereGeometry(1, 32, 24);
        const material = new THREE.MeshStandardMaterial({ color, roughness: .5, metalness: shape === "box" ? .18 : .03 });
        const obj = new THREE.Mesh(geometry, material);
        if (shape === "ellipsoid") obj.scale.set(size[0], size[1], size[2]);
        else if (shape === "sphere") obj.scale.setScalar(size[0]);
        obj.castShadow = shape !== "plane"; obj.receiveShadow = true; scene.add(obj); return obj;
      }
      const objects = motion.geometry.map((g) => {
        const obj = mesh(g.shape, g.half_size_m, new THREE.Color(g.rgba[0], g.rgba[1], g.rgba[2]));
        obj.visible = g.rgba[3] > 0 && !(context && g.name === "floor");
        return obj;
      });
      const room = context ? operatingRoom(motion) : null;
      if (room) scene.add(room);
      const heart = context ? presentationHeart() : null;
      const heartIndex = motion.geometry.findIndex((g) => g.name === "object_collision");
      if (heart) scene.add(heart);
      if (room) {
        const trayIndex = motion.geometry.findIndex((g) => g.name === "tray_floor");
        if (trayIndex >= 0) room.add(operativeDetails(motion.frames[0].poses[trayIndex].position_m));
        motion.geometry.forEach((g, i) => {
          if (g.name.startsWith("cavity_wall") || g.name.startsWith("tray_") || g.name.startsWith("visual_")) objects[i].visible = false;
        });
      }
      const composer = context ? new EffectComposer(renderer) : null;
      const ao = composer ? new SSAOPass(scene, camera, 512, 512) : null;
      const renderPass = composer ? new RenderPass(scene, camera) : null;
      const outputPass = composer ? new OutputPass() : null;
      const fxaa = composer ? new FXAAPass() : null;
      if (composer && ao && renderPass && outputPass) {
        ao.kernelRadius = .055; ao.minDistance = .0003; ao.maxDistance = .1;
        composer.addPass(renderPass); composer.addPass(ao); composer.addPass(outputPass);
        if (fxaa) composer.addPass(fxaa);
      }
      let assetsReady = !context, captured = false;
      let updateRobot: ((time: number) => void) | null = null;
      let updateGripper: ((time: number) => void) | null = null;
      let robotMixer: THREE.AnimationMixer | null = null;
      let robotRoot: THREE.Object3D | null = null;
      const robotActions: THREE.AnimationAction[] = [];
      const bindings: { anchor: THREE.Group; index: number }[] = [];
      const disposeTree = (root: THREE.Object3D) => {
        const textures = new Set<THREE.Texture>();
        root.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.Line)) return;
          obj.geometry.dispose();
          for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
            material.dispose();
          }
        });
        textures.forEach((texture) => texture.dispose());
      };
      if (room) {
        setBundledStatus("Loading patient and robot…");
        const loader = new GLTFLoader(), textures = new THREE.TextureLoader();
        // allSettled ensures partial loads are disposed when navigating away or on failure.
        Promise.allSettled([
          loader.loadAsync("/models/patient/LeePerrySmith.glb"),
          textures.loadAsync("/models/patient/Map-COL.jpg"),
          textures.loadAsync("/models/patient/Infinite-Level_02_Tangent_SmoothUV.jpg"),
          motion.presentation_assets?.recording_specific && !motion.presentation_assets.robot_motion ? Promise.resolve(null) : loader.loadAsync(motion.presentation_assets?.robot_glb ?? "/models/robot/panda.glb"),
        ]).then((results) => {
          if (cancelled || results.some((r) => r.status === "rejected")) {
            for (const result of results) if (result.status === "fulfilled") {
              if (result.value instanceof THREE.Texture) result.value.dispose(); else if (result.value) disposeTree(result.value.scene);
            }
            if (!cancelled) { assetsReady = true; dirty = true; setBundledStatus("Patient/robot assets unavailable. Reload to retry."); }
            return;
          }
          const [head, color, normal, robot] = results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
            Awaited<ReturnType<GLTFLoader["loadAsync"]>>, THREE.Texture, THREE.Texture, Awaited<ReturnType<GLTFLoader["loadAsync"]>>,
          ];
          // This legacy scan uses the original image UV orientation (as in its source demo).
          color.colorSpace = THREE.SRGBColorSpace; color.flipY = true; normal.flipY = true;
          color.anisotropy = normal.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
          const skin = new THREE.MeshPhysicalMaterial({ map: color, normalMap: normal,
            normalScale: new THREE.Vector2(.65, .65), roughness: .52, clearcoat: .12, clearcoatRoughness: .6 });
          head.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) mat.dispose();
              obj.material = skin; obj.castShadow = true; obj.receiveShadow = true;
            }
          });
          head.scene.scale.setScalar(.036); head.scene.position.set(0, .565, -.027);
          head.scene.name = "scanned_patient_head"; room.add(head.scene);
          assetsReady = true; dirty = true;
          if (!robot) { setBundledStatus(""); return; }
          robotRoot = robot.scene;
          robot.scene.traverse((obj) => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true; } });
          room.add(robot.scene);
          const fit = motion.presentation_assets?.robot_motion;
          if (fit && fit.seed === motion.seed && fit.checkpoint_sha256 === motion.checkpoint_sha256 && fit.frames.length === motion.frames.length) {
            updateRobot = recordedRobot(robot.scene, fit, motion.sample_hz);
          } else if (!motion.presentation_assets?.recording_specific) {
            robotMixer = new THREE.AnimationMixer(robot.scene);
          for (const clip of robot.animations) {
            const action = robotMixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
            robotActions.push(action);
          }
          } else {
            room.remove(robot.scene); disposeTree(robot.scene); robotRoot = null;
            setBundledStatus("Robot fit does not match this recording. Showing measured instruments."); return;
          }
          updateGripper = recordedHeartGripper(robot.scene, motion);
          motion.geometry.forEach((g, i) => { if (["palm", "finger_l", "finger_r"].includes(g.name)) objects[i].visible = false; });
          setBundledStatus("");
        }).catch((reason) => { if (!cancelled) setBundledStatus(`Scene assets failed: ${String(reason)}`); });
      }
      const resize = new ResizeObserver(() => {
        dirty = true;
        const { width, height } = container.getBoundingClientRect();
        renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix();
        composer?.setSize(width, height);
      });
      resize.observe(container);
      const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
      const pa = new THREE.Vector3(), pb = new THREE.Vector3();
      let frameId = 0;
      function draw() {
        controls.mouseButtons.LEFT=navigationRef.current==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;
        controls.touches.ONE=navigationRef.current==='pan'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
        renderer.domElement.dataset.navigation=navigationRef.current;
        renderer.domElement.dataset.time=String(cursor.current);
        const f = Math.min(Math.max(cursor.current * motion.sample_hz, 0), motion.frames.length - 1);
        const a = Math.floor(f), b = Math.min(a + 1, motion.frames.length - 1), alpha = f - a;
        objects.forEach((obj, i) => {
          const x = motion.frames[a].poses[i], y = motion.frames[b].poses[i];
          pa.fromArray(x.position_m); pb.fromArray(y.position_m); obj.position.lerpVectors(pa, pb, alpha);
          const q = x.quaternion_wxyz, r = y.quaternion_wxyz;
          qa.set(q[1], q[2], q[3], q[0]); qb.set(r[1], r[2], r[3], r[0]);
          obj.quaternion.slerpQuaternions(qa, qb, alpha);
        });
        bindings.forEach(({ anchor, index }) => {
          anchor.position.copy(objects[index].position); anchor.quaternion.copy(objects[index].quaternion);
        });
        if (heart && heartIndex >= 0) {
          heart.position.copy(objects[heartIndex].position); heart.quaternion.copy(objects[heartIndex].quaternion);
        }
        updateRobot?.(cursor.current);
        // Setting absolute clip time makes seek, reverse seek and pause deterministic.
        if (robotMixer) {
          robotActions.forEach((action) => { action.paused = false; action.enabled = true; });
          robotMixer.setTime(Math.min(cursor.current, motion.duration_s));
        }
        // Apply after either animation source so older saved fits cannot overwrite the claw opening.
        updateGripper?.(cursor.current);
        const moved = controls.update();
        if (dirty || moved || lastTime !== cursor.current) {
          if (composer) composer.render(); else renderer.render(scene, camera);
          dirty = false; lastTime = cursor.current;
          if (assetsReady && !captured && capture.current) { captured = true; capture.current(renderer.domElement.toDataURL("image/webp", .86)); }
        }
        frameId = requestAnimationFrame(draw);
      }
      draw();
      dispose = () => {
        cancelAnimationFrame(frameId); resize.disconnect(); controls.dispose();
        if (robotMixer && robotRoot) { robotMixer.stopAllAction(); robotMixer.uncacheRoot(robotRoot); }
        ao?.dispose(); renderPass?.dispose(); outputPass?.dispose(); fxaa?.dispose(); composer?.dispose();
        disposeTree(scene); environment.dispose(); light.shadow.dispose(); cameraView.current = () => {};
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
    }).catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; dispose(); };
  }, [motion, context, initialView, guide]);
  return <div className="motion-canvas" ref={host} data-scene-ready={context && bundledStatus === ""} aria-label="Recorded heart extraction in an interactive 3D scene">
    <CameraControls view={angle} onView={v=>{setAngle(v);cameraView.current(v);}} mode={navigation} onMode={setNavigation} geometry={!context}/>
    {context && bundledStatus && <div className="scene-tools"><span role="status">{bundledStatus}</span></div>}
    {error && <p className="motion-error">3D graphics unavailable. Select Original simulation to watch the recorded rollout. {error}</p>}
  </div>;
}
