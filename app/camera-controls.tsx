"use client";
import { Focus, Move, RotateCcw } from 'lucide-react';
import './camera-controls.css';

export type CameraView = 'room' | 'patient' | 'field' | 'macro' | 'overhead';
export type NavigationMode = 'orbit' | 'pan';
const views: [CameraView, string][] = [['room','Room view'],['patient','Patient'],['field','Operative field'],['macro','Macro'],['overhead','Overhead']];

export default function CameraControls({view,onView,mode,onMode,geometry=false}: {
  view: string; onView: (view: CameraView)=>void;
  mode: NavigationMode; onMode: (mode: NavigationMode)=>void; geometry?: boolean;
}) {
  return <div className="procedure-camera-controls">
    <div role="group" aria-label="Camera views">{views.filter(([id])=>!geometry || !['room','patient'].includes(id)).map(([id,label])=>
      <button key={id} aria-pressed={view===id} onClick={()=>onView(id)}>{id==='macro'?<Focus size={14}/>:<Move size={14}/>} {label}</button>)}</div>
    <div role="group" aria-label="Camera navigation">
      <button aria-pressed={mode==='orbit'} onClick={()=>onMode('orbit')}><RotateCcw size={14}/> Orbit</button>
      <button aria-pressed={mode==='pan'} onClick={()=>onMode('pan')}><Move size={14}/> Pan</button>
    </div>
  </div>;
}
