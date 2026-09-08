import math
import mujoco
import numpy as np

DT=.05
DELTA=np.array([.002,.002,.002,.04])
ARC=2*math.pi/3
VERSION='needle-channel-v1'
OBS_NAMES=['center_x','center_y','center_z','theta','velocity_x','velocity_y','velocity_z','angular_velocity',
    'goal_minus_center_x','goal_minus_center_y','goal_minus_center_z','goal_minus_theta',
    'radius','sin_theta','cos_theta','tip_x','tip_y','tip_z','entry_x','entry_y','entry_z','exit_x','exit_y','exit_z',
    'entered','exited','maximum_depth']


def scene(seed):
    r=np.random.default_rng(seed)
    return dict(seed=int(seed),center=[float(r.uniform(-.018,.018)),float(r.uniform(-.012,.012)),float(r.uniform(.038,.048))],
        radius=float(r.uniform(.022,.028)),initial_offset=[float(r.uniform(-.006,.006)),float(r.uniform(-.006,.006)),float(r.uniform(.004,.010))],
        initial_theta=float(math.pi-r.uniform(.50,.70)))


def xml(config):
    cx,cy,z=config['center']; radius=config['radius']; gap=.0035
    parts=[]
    for i in range(24):
        a=-ARC+i*ARC/24; b=-ARC+(i+1)*ARC/24
        parts.append(f'<geom name="needle_{i}" type="capsule" fromto="{radius*math.cos(a)} 0 {radius*math.sin(a)} {radius*math.cos(b)} 0 {radius*math.sin(b)}" size=".0006" rgba=".7 .76 .83 1"/>')
    tail=[radius*math.cos(-ARC),0,radius*math.sin(-ARC)]
    pad=[]
    # Four rigid blocks leave a pre-cut slot. Needle/pad collision remains enabled.
    for name,pos,size in [('near',[cx,cy-.027,z/2],[.060,.0235,z/2]),('far',[cx,cy+.027,z/2],[.060,.0235,z/2]),
                          ('left',[cx-radius-.019,cy,z/2],[.015,gap,z/2]),('right',[cx+radius+.019,cy,z/2],[.015,gap,z/2])]:
        pad.append(f'<geom name="pad_{name}" type="box" pos="{" ".join(map(str,pos))}" size="{" ".join(map(str,size))}" rgba=".66 .28 .30 1"/>')
    markers=''.join(f'<geom name="{name}" type="sphere" pos="{x} {cy} {z}" size=".0017" contype="0" conaffinity="0" rgba="{color}"/>' for name,x,color in [('entry',cx-radius,'.2 .9 .6 .65'),('exit',cx+radius,'.2 .65 1 .65')])
    return f'''<mujoco model="curved_needle_channel"><compiler angle="radian"/><option timestep=".002" integrator="implicitfast"/>
    <default><joint damping=".05"/><geom friction=".5 .005 .0001" solref=".006 1"/></default>
    <visual><global offwidth="960" offheight="720"/></visual><worldbody>
    <light pos="0 -.15 .4" diffuse="1 1 1"/><light pos=".15 .1 .25" diffuse=".6 .7 .8"/>
    <camera name="overview" pos=".095 -.17 .135" xyaxes=".88 .47 0 -.23 .43 .872"/>
    <geom name="floor" type="plane" size=".3 .3 .01" rgba=".12 .17 .21 1"/>{''.join(pad)}{markers}
    <body name="driver" gravcomp="1"><inertial pos="0 0 0" mass=".15" diaginertia=".0001 .0001 .0001"/>
    <joint name="x" type="slide" axis="1 0 0"/><joint name="y" type="slide" axis="0 1 0"/><joint name="z" type="slide" axis="0 0 1"/>
    <joint name="needle_rotation" type="hinge" axis="0 -1 0"/>{''.join(parts)}
    <geom name="holder" type="capsule" fromto="{tail[0]} -.003 {tail[2]} {tail[0]} -.024 {tail[2]}" size=".002" rgba=".25 .4 .65 1" contype="0" conaffinity="0"/>
    <site name="tip" pos="{radius} 0 0" size=".0008" rgba="1 .7 .15 1"/>
    </body></worldbody><actuator><position joint="x" kp="800" kv="22"/><position joint="y" kp="800" kv="22"/><position joint="z" kp="800" kv="22"/>
    <position joint="needle_rotation" kp="1.5" kv=".025"/></actuator></mujoco>'''


class NeedleDriveEnv:
    def reset(self,seed=0,config=None):
        self.config=config or scene(seed); self.center=np.array(self.config['center']); self.radius=self.config['radius']
        self.entry=self.center+[-self.radius,0,0]; self.exit=self.center+[self.radius,0,0]
        self.goal=np.r_[self.center,2*math.pi+ARC+.20]
        self.model=mujoco.MjModel.from_xml_string(xml(self.config)); self.data=mujoco.MjData(self.model)
        self.data.qpos[:]=np.r_[self.center+np.array(self.config['initial_offset']),self.config['initial_theta']]
        self.data.ctrl[:]=self.data.qpos
        mujoco.mj_forward(self.model,self.data)
        self.entered=self.exited=False; self.depth=0.; self.entry_error=self.exit_error=None
        self.unwanted=0; self.peak_contact_force=0.; self.steps=self.stable=0; self.failure=None; self.pairs=set()
        return self.observation()

    @property
    def tip(self): return self.data.site('tip').xpos.copy()

    def observation(self):
        q=self.data.qpos
        return np.r_[q,self.data.qvel,self.goal-q,self.radius,math.sin(q[3]),math.cos(q[3]),self.tip,
                     self.entry,self.exit,self.entered,self.exited,self.depth].astype(np.float32)

    def step(self,action):
        a=np.asarray(action,dtype=float)
        if a.shape!=(4,) or not np.isfinite(a).all(): raise ValueError('Expected finite action shape (4,)')
        target=self.data.qpos+np.clip(a,-1,1)*DELTA
        self.data.ctrl[:]=np.clip(target,[-.06,-.05,.025,1.8],[.06,.05,.08,9.0])
        for _ in range(25):
            previous=self.tip; mujoco.mj_step(self.model,self.data)
            # Kinematics refresh only; do not run a second dynamics solve.
            mujoco.mj_kinematics(self.model,self.data)
            tip=self.tip; surface=self.center[2]
            if previous[2]>=surface and tip[2]<surface:
                alpha=(surface-previous[2])/(tip[2]-previous[2]); crossing=previous+alpha*(tip-previous)
                error=float(np.linalg.norm(crossing[:2]-self.entry[:2]))
                if not self.entered and error<=.002 and self.data.qvel[3]>0:
                    self.entered=True; self.entry_error=error
                else: self.failure='invalid_entry'
            if self.entered:
                self.depth=max(self.depth,float(surface-tip[2]))
                if previous[2]<surface and tip[2]>=surface:
                    alpha=(surface-previous[2])/(tip[2]-previous[2]); crossing=previous+alpha*(tip-previous)
                    error=float(np.linalg.norm(crossing[:2]-self.exit[:2]))
                    if not self.exited and error<=.002 and self.depth>=.75*self.radius and self.data.qvel[3]>0:
                        self.exited=True; self.exit_error=error
                    else: self.failure='invalid_exit'
            pairs=set()
            for i,c in enumerate(self.data.contact):
                names=[self.model.geom(int(g)).name for g in [c.geom1,c.geom2]]
                if any(n.startswith('needle_') for n in names) and any(n.startswith('pad_') or n=='floor' for n in names):
                    pairs.add(tuple(sorted(names))); force=np.zeros(6); mujoco.mj_contactForce(self.model,self.data,i,force)
                    self.peak_contact_force=max(self.peak_contact_force,float(np.linalg.norm(force[:3])))
            self.unwanted+=len(pairs-self.pairs); self.pairs=pairs
            if pairs: self.failure='unwanted_contact'
        self.steps+=1
        theta=self.data.qpos[3]
        angles=np.linspace(theta-ARC,theta,25)
        lowest=float(self.data.qpos[2]+self.radius*np.sin(angles).min()-.0006)
        settled=np.linalg.norm(self.data.qvel[:3])<.001 and abs(self.data.qvel[3])<.035
        good=self.entered and self.exited and lowest>self.center[2]+.001 and abs(theta-self.goal[3])<.035 and settled and not self.failure
        self.stable=self.stable+1 if good else 0
        success=self.stable>=10; terminated=bool(success or self.failure); truncated=self.steps>=400 and not terminated
        info=dict(success=success,termination='success' if success else (self.failure or ('timeout' if truncated else 'running')),
            steps=self.steps,entry_error_m=self.entry_error,exit_error_m=self.exit_error,maximum_depth_m=self.depth,
            unwanted_collisions=self.unwanted,peak_contact_force_n=self.peak_contact_force,needle_clear=bool(lowest>self.center[2]+.001))
        return self.observation(),float(success),terminated,truncated,info

    def state(self): return np.r_[self.data.qpos,self.data.qvel,self.data.ctrl]
