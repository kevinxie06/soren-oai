"use client";
import Link from "next/link";
import FullscreenButton from "../fullscreen-button";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Download, Pause, Play, RotateCcw, ChevronLeft } from "lucide-react";
import Viewer from "./viewer";
import CameraControls, { type NavigationMode } from "../camera-controls";
import { presentationMotion, gapAtTime } from "./presentation";
import PolicyComparison, { type PolicyVersion } from "../policy-comparison";
import type { StitchMotion } from "./types";
import "./suturing.css";

export default function SuturingPage(){
  const [motion,setMotion]=useState<StitchMotion|null>(null),[error,setError]=useState("");
  const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(.75);
  const [navigation,setNavigation]=useState<NavigationMode>("orbit");
  const [source,setSource]=useState("render"),[angle,setAngle]=useState("room");
  const [assetStatus,setAssetStatus]=useState('Loading patient and robot…');
  const [version,setVersion]=useState<PolicyVersion>("current");
  const motionBase=`/motion/stitch${version==="old"?"-old":""}`;
  const cursor=useRef(0),video=useRef<HTMLVideoElement>(null);
  useEffect(()=>{cursor.current=time;},[time]);
  useEffect(()=>{const abort=new AbortController();fetch(`${motionBase}.json`,{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error('Suturing recording is unavailable');return r.json();}).then(d=>{if(d.schema_version!=='soren.stitch.v1'||!d.frames?.length)throw new Error('Unsupported recording');setMotion(d);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>abort.abort();},[motionBase]);
  useEffect(()=>{if(!playing||!motion||source==='video')return;let last=performance.now(),id=0;function tick(now:number){const dt=Math.min((now-last)/1000,.1)*speed;last=now;setTime(t=>Math.min(motion!.duration_s,t+dt));if(cursor.current>=motion!.duration_s){setPlaying(false);return;}id=requestAnimationFrame(tick);}id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[playing,motion,speed,source]);
  const stabilized=useMemo(()=>motion?presentationMotion(motion):null,[motion]);
  const displayMotion=source==='render'?stabilized:motion;
  const frame=motion?.frames[Math.min(Math.floor(time*motion.sample_hz),motion.frames.length-1)];
  function seek(t:number){setTime(t);if(video.current)video.current.currentTime=Math.max(0,t-.05);}
  function toggle(){if(!motion)return;const next=time>=motion.duration_s||!playing;if(time>=motion.duration_s)seek(0);setPlaying(next);if(video.current){video.current.playbackRate=speed;if(next)void video.current.play().catch(()=>setPlaying(false));else video.current.pause();}}
  function switchSource(value:string){setPlaying(false);video.current?.pause();setSource(value);if(value!=='video')setAngle(value==='geometry'?'macro':'room');}
  const stages=['Align needle','Drive across wound','Receive & pull through','Tension & close'];
  return <main className="suture-app">
    <header className="suture-header"><Link href="/showcase" className="suture-logo">soren<span>PROCEDURE STUDIO</span></Link><nav><Link href="/showcase"><ChevronLeft size={14}/> Heart extraction</Link><span className="suture-tag">POLICY PLAYBACK <i/></span></nav></header>
    <div className="suture-layout"><section data-procedure-player className="suture-stage">
      <PolicyComparison task="stitch" value={version} onChange={next=>{video.current?.pause();setPlaying(false);setTime(0);cursor.current=0;setMotion(null);setError("");setVersion(next);}}/>
      <div className="suture-stage-top"><div className="suture-source"><button aria-pressed={source==='render'} onClick={()=>switchSource('render')}>Surgical rendering</button><button aria-pressed={source==='geometry'} onClick={()=>switchSource('geometry')}>Simulation geometry</button><button aria-pressed={source==='video'} onClick={()=>switchSource('video')}>Original simulation</button></div><span className="suture-seed">RECORDED / {motion?.scene.seed??'—'}</span></div>
      <div className="suture-viewport"><FullscreenButton/>{error?<p role="alert">{error}</p>:!motion?<div className="suture-loading">Preparing operative field…</div>:source!=='video'?<Viewer key={version} motion={displayMotion!} time={time} angle={angle} navigation={navigation} geometry={source==='geometry'} asset={null} onStatus={setAssetStatus}/>:<video ref={video} key={version} src={`${motionBase}.mp4`} controls playsInline preload="auto" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onLoadedMetadata={()=>{if(video.current){video.current.currentTime=Math.max(0,time-.05);video.current.playbackRate=speed;}}} onTimeUpdate={()=>{if(video.current)setTime(Math.min(motion.duration_s,video.current.currentTime+.05));}} onEnded={()=>{setPlaying(false);setTime(motion.duration_s);}}><track kind="captions" src={`${motionBase}.vtt`} srcLang="en" label="English" default/></video>}
        <div className="suture-field-label"><span className="live-dot"/> {version==='old'?'OLD VERSION':'CURRENT VERSION'} <span>/</span> SINGLE STITCH</div>
        {source!=='video'&&<CameraControls view={angle} onView={setAngle} mode={navigation} onMode={setNavigation} geometry={source==='geometry'}/>}
        <div className="suture-overlay"><span>WOUND GAP</span><strong data-testid="wound-gap">{displayMotion?(gapAtTime(displayMotion,time)*1000).toFixed(2):'—'}<small>mm</small></strong></div>
      </div>
      <div className="suture-playback"><button className="suture-play" aria-label={playing?'Pause playback':'Play playback'} onClick={toggle}>{playing?<Pause size={19}/>:<Play size={19}/>}</button><button aria-label="Restart playback" onClick={()=>{setPlaying(false);video.current?.pause();seek(0);}}><RotateCcw size={17}/></button><input aria-label="Playback position" type="range" min="0" max={motion?.duration_s??1} step="0.01" value={time} onChange={e=>seek(Number(e.target.value))}/><span className="suture-time">{time.toFixed(2)} <em>/ {motion?.duration_s.toFixed(2)??'—'}</em></span><select aria-label="Playback speed" value={speed} onChange={e=>{const s=Number(e.target.value);setSpeed(s);if(video.current)video.current.playbackRate=s;}}>{[.25,.5,.75,1,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></div>
      <div className="suture-chapters">{stages.map((stage,i)=><button key={stage} disabled={!motion?.frames.some(f=>f.phase===stage)} aria-current={frame?.phase===stage?'step':undefined} onClick={()=>{const target=motion?.frames.find(f=>f.phase===stage);if(target)seek(target.time_s);}}><span>0{i+1}</span>{stage}</button>)}</div>
      {source==='render'&&assetStatus&&<div className="suture-asset-tools"><span role="status" data-testid="room-status">{assetStatus}</span></div>}
    </section><aside className="suture-info"><p className="suture-eyebrow">MANIPULATION / 002</p><h1>A precise pass.<br/><span>A closer wound.</span></h1><p className="suture-description">Across the incision. Into the receiving jaw. Drawn together with controlled thread tension.</p>
      <div className="suture-phase" role="status"><span className="live-dot"/><div><small>CURRENT ACTION</small><strong>{frame?.phase??'Loading recording'}</strong></div></div>
      <dl className="suture-metrics"><div><dt>Initial opening</dt><dd>{motion?(motion.scene.gap*1000).toFixed(2):'—'} <small>mm</small></dd></div><div><dt>Thread tension</dt><dd>{frame?frame.tension_n.toFixed(2):'—'} <small>N</small></dd></div><div><dt>Receiving jaw</dt><dd className={frame?.receiver_holding?'caught':''}>{frame?.receiver_holding?'Needle secured':'Awaiting needle'}</dd></div><div><dt>Driving jaw</dt><dd>{frame?.donor_holding?'Holding':'Released'}</dd></div></dl>
      <div className={`suture-result${motion&&!motion.result.success?" failed":""}`}><strong>{motion?.evaluation?`${motion.evaluation.successes}/${motion.evaluation.episodes}`:'—'}<span>successful test scenes</span></strong><p>{motion?(motion.result.success?"Recorded episode completed successfully.":`Recorded episode failed: ${motion.result.termination?.replaceAll("_"," ")??"incomplete"}.`):"Loading result?"}</p></div>
      <a className="suture-download" href={`${motionBase}.json`} download><Download size={16}/> Download motion data <ArrowUpRight size={16}/></a>
      <p className="suture-disclosure">Scanned patient, draped body and articulated robot around the recorded stitch. Robot articulation is fitted for presentation, not a validated surgical robot. Skin and filament detail are visual approximations. The simulation uses simplified penetration and assisted grasping. Closure is held under tension; no knot is tied. <a href="/models/ATTRIBUTION.md">Patient and robot credits</a> · <a href="/models/stitch/ATTRIBUTION.md">Material credits</a></p>
    </aside></div>
    <footer className="suture-footer"><span>THREE.JS / NATIVE WEBGL</span><span>20 Hz measured trajectory · {motion?.result.checkpoint_sha256.slice(0,12)??'…'}</span><Link href="/showcase">Explore heart extraction <ArrowUpRight size={12}/></Link></footer>
  </main>;
}
