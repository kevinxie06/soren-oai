"use client";
import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import './fullscreen-button.css';

export default function FullscreenButton() {
  const button = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === button.current?.closest('[data-procedure-player]'));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  async function toggle() {
    const player = button.current?.closest<HTMLElement>('[data-procedure-player]');
    if (!player) return;
    setError('');
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else await player.requestFullscreen();
    } catch {
      setError('Fullscreen is unavailable in this browser.');
    }
  }
  return <div className="procedure-fullscreen">
    <button ref={button} type="button" onClick={toggle} aria-label={active?'Exit fullscreen':'Enter fullscreen'} aria-pressed={active} title={active?'Exit fullscreen (Esc)':'Enter fullscreen'}>
      {active?<Minimize size={16}/>:<Maximize size={16}/>}<span>{active?'Exit fullscreen':'Fullscreen'}</span>
    </button>
    {error&&<span role="status">{error}</span>}
  </div>;
}
