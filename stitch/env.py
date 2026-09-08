import math
import mujoco
import numpy as np

DT=.05
DELTA=np.array([.0015,.0015,.0015,.05])
VERSION='opposing-jaw-stitch-v1'
OBS_NAMES=['center_x','center_y','center_z','theta','vx','vy','vz','omega',
 'alignment_dx','alignment_dy','alignment_dz','finish_dtheta','radius','sin_theta','cos_theta',
 'tip_x','tip_y','tip_z','entry_x','entry_y','entry_z','exit_x','exit_y','exit_z',
 'entered','exited','caught','donor_holding','receiver_holding','donor_closure','receiver_closure',
 'needle_clear','wound_gap','initial_gap','left_velocity','right_velocity','tension_n','maximum_depth']


def scene(seed):
    r=np.random.default_rng(seed)
    return dict(seed=int(seed),center=[float(r.uniform(-.01,.01)),float(r.uniform(-.008,.008)),.024],
                radius=float(r.uniform(.012,.016)),gap=float(r.uniform(.006,.010)),
                initial_offset=[float(r.uniform(-.003,.003)),float(r.uniform(-.003,.003)),float(r.uniform(.003,.006))],
                tissue_stiffness=float(r.uniform(65,85)))


def xml(c):
    cx,cy,z=c['center']; r=c['radius']; gap=c['gap']; parts=[]
    for i in range(32):
        a=-math.pi+i*math.pi/32; b=-math.pi+(i+1)*math.pi/32
        parts.append(f'<geom name="needle_{i}" type="capsule" fromto="{r*math.cos(a)} 0 {r*math.sin(a)} {r*math.cos(b)} 0 {r*math.sin(b)}" size=".00045" rgba=".8 .83 .9 1" contype="2" conaffinity="0"/>')
    pads=[]
    for name,sign in [('left',-1),('right',1)]:
        # Two spring-mounted wound edges; their inward displacement is dynamic.
        pads.append(f'''<body name="{name}_edge" pos="{cx+sign*(gap/2+.021)} {cy} {z/2}">
          <joint name="{name}_edge" type="slide" axis="{-sign} 0 0" stiffness="{c['tissue_stiffness']}" damping="2" limited="true" range="0 {gap/2-.00015}"/>
          <geom name="pad_{name}" type="box" size=".021 .043 {z/2}" mass=".05" rgba=".70 .34 .36 1" contype="1" conaffinity="1"/>
          <site name="{name}_stitch" pos="{sign*(r-gap/2-.021)} 0 {z/2+.0005}" size=".001" rgba=".1 .7 .4 1"/>
          </body>''')
    jaws=[]
    for name,col in [('donor','.30 .55 .85'),('receiver','.80 .65 .25')]:
        jaws.append(f'''<body name="{name}" mocap="true"><geom type="capsule" fromto="0 -.042 .014 0 -.014 0" size=".002" rgba="{col} 1" contype="0" conaffinity="0"/>
         <geom type="capsule" fromto="0 -.014 0 0 -.003 0" size=".0008" rgba="{col} 1" contype="0" conaffinity="0"/>
         <geom type="capsule" fromto="0 -.014 .002 0 .003 0" size=".0008" rgba="{col} 1" contype="0" conaffinity="0"/>
         <geom name="{name}_finger_a" type="box" pos="0 -.003 0" size=".002 .002 .001" rgba="{col} 1" contype="0" conaffinity="0"/>
         <geom name="{name}_finger_b" type="box" pos="0 .003 0" size=".002 .002 .001" rgba="{col} 1" contype="0" conaffinity="0"/></body>''')
    return f'''<mujoco model="opposing_jaw_stitch"><compiler angle="radian"/><option timestep=".002" integrator="implicitfast"/>
      <default><geom solref=".006 1"/></default><visual><global offwidth="960" offheight="720"/></visual>
      <worldbody><light pos="0 -.15 .3"/><light pos=".1 .1 .3" diffuse=".7 .7 .7"/>
      <camera name="overview" pos=".075 -.12 .14" xyaxes=".85 .53 0 -.37 .60 .71"/>
      <geom name="floor" type="plane" size=".3 .3 .01" rgba=".10 .14 .18 1" contype="1" conaffinity="3"/>
      {''.join(pads)}{''.join(jaws)}
      <body name="driver" gravcomp="1"><inertial pos="0 0 0" mass=".15" diaginertia=".0001 .0001 .0001"/>
      <joint name="x" type="slide" axis="1 0 0" damping=".05"/><joint name="y" type="slide" axis="0 1 0" damping=".05"/><joint name="z" type="slide" axis="0 0 1" damping=".05"/>
      <joint name="theta" type="hinge" axis="0 -1 0" damping=".025"/>{''.join(parts)}
      <site name="tip" pos="{r} 0 0" size=".0006" rgba="1 .85 .3 1"/><site name="tail" pos="{-r} 0 0" size=".0005" rgba=".3 .3 .3 1"/>
      </body></worldbody><tendon><spatial name="stitch" width=".0003" rgba=".12 .16 .22 0"><site site="left_stitch"/><site site="right_stitch"/></spatial></tendon>
      <actuator><position joint="x" kp="800" kv="22"/><position joint="y" kp="800" kv="22"/><position joint="z" kp="800" kv="22"/>
      <position joint="theta" kp="1.5" kv=".025"/><motor tendon="stitch" gear="1" ctrllimited="true" ctrlrange="-.6 0"/></actuator></mujoco>'''


class StitchEnv:
    def reset(self,seed=0,config=None):
        self.config=config or scene(seed); self.center=np.array(self.config['center']); self.radius=self.config['radius']
        self.entry=self.center+[-self.radius,0,0]; self.exit=self.center+[self.radius,0,0]
        self.goal=np.r_[self.center,3*math.pi+.15]
        self.model=mujoco.MjModel.from_xml_string(xml(self.config)); self.data=mujoco.MjData(self.model)
        self.qids=np.array([self.model.joint(n).qposadr[0] for n in ['x','y','z','theta']])
        self.vids=np.array([self.model.joint(n).dofadr[0] for n in ['x','y','z','theta']])
        self.data.qpos[self.qids]=np.r_[self.center+self.config['initial_offset'],math.pi]
        self.data.ctrl[:4]=self.q; mujoco.mj_forward(self.model,self.data)
        self.entered=self.exited=self.caught=False; self.donor=True; self.receiver=False
        self.closure=np.array([1.,0.]); self.depth=0.; self.entry_error=self.exit_error=None
        self.failure=None; self.steps=self.stable=0; self.unwanted=0; self.tension=0.
        self.released_position=None; self._jaws(); return self.observation()

    @property
    def q(self): return self.data.qpos[self.qids].copy()
    @property
    def v(self): return self.data.qvel[self.vids].copy()
    @property
    def tip(self): return self.data.site('tip').xpos.copy()
    @property
    def gap(self): return float(self.config['gap']-self.data.qpos[0]-self.data.qpos[1])
    @property
    def clear(self):
        angles=np.linspace(self.q[3]-math.pi,self.q[3],33)
        return bool(self.exited and self.q[2]+self.radius*np.sin(angles).min()-.00045>self.center[2]+.0005)

    def _jaws(self):
        tail=self.data.site('tail').xpos.copy()
        if not self.donor:
            if self.released_position is None: self.released_position=tail.copy()
            tail=self.released_position+[0,-.012,.012]
        self.data.mocap_pos[0]=tail if self.donor else self.data.mocap_pos[0]+.25*(tail-self.data.mocap_pos[0])
        self.data.mocap_pos[1]=self.tip if self.receiver else self.exit+[0,0,.0005]
        for i,name in enumerate(['donor','receiver']):
            for suffix,sign in [('a',-1),('b',1)]:
                self.model.geom(f'{name}_finger_{suffix}').pos[1]=sign*(.0022+.0025*(1-self.closure[i]))

    def observation(self):
        q=self.q
        return np.r_[q,self.v,self.goal-q,self.radius,math.sin(q[3]),math.cos(q[3]),self.tip,self.entry,self.exit,
                     self.entered,self.exited,self.caught,self.donor,self.receiver,self.closure,self.clear,self.gap,
                     self.config['gap'],self.data.qvel[:2],self.tension,self.depth].astype(np.float32)

    def step(self,action):
        a=np.asarray(action,float)
        if a.shape!=(7,) or not np.isfinite(a).all(): raise ValueError('Expected finite action shape (7,)')
        a=np.clip(a,-1,1); self.closure += .7*((a[4:6]+1)/2-self.closure)
        # Guarded assisted latch: receive only at the actual exit, with closed jaws.
        distance=np.linalg.norm(self.tip-(self.exit+[0,0,.0005]))
        if not self.receiver and self.exited and distance<.002 and self.closure[1]>.8:
            self.receiver=True; self.caught=True
        if self.closure[0]<.2: self.donor=False
        if self.receiver and self.closure[1]<.2: self.receiver=False
        if not self.donor and not self.receiver: self.failure='lost_needle'
        if self.donor and self.q[3]>2*math.pi+.13: self.failure='donor_overtravel'
        target=self.q+a[:4]*DELTA
        self.data.ctrl[:4]=np.clip(target,[-.04,-.04,.018,3.0],[.04,.04,.045,9.8])
        # Only a completed pass installs a load-bearing thread; no automatic closure.
        self.tension=float(max(0,a[6])*.6) if self.clear and self.caught and not self.donor else 0.
        self.data.ctrl[4]=-self.tension
        self.model.tendon_rgba[0,3]=1 if self.clear and self.caught else 0
        for _ in range(25):
            previous=self.tip; mujoco.mj_step(self.model,self.data); mujoco.mj_kinematics(self.model,self.data)
            tip=self.tip; z=self.center[2]
            if previous[2]>=z and tip[2]<z and not self.entered:
                cross=previous+(z-previous[2])/(tip[2]-previous[2])*(tip-previous)
                self.entry_error=float(np.linalg.norm(cross[:2]-self.entry[:2]))
                if self.entry_error<.0015 and self.v[3]>0: self.entered=True
                else: self.failure='invalid_entry'
            if self.entered and not self.exited:
                self.depth=max(self.depth,float(z-tip[2]))
                if previous[2]<z and tip[2]>=z:
                    cross=previous+(z-previous[2])/(tip[2]-previous[2])*(tip-previous)
                    self.exit_error=float(np.linalg.norm(cross[:2]-self.exit[:2]))
                    if self.exit_error<.0015 and self.depth>.7*self.radius and self.v[3]>0: self.exited=True
                    else: self.failure='invalid_exit'
            # Penetration surrogate: allow the intended XZ bite plane only.
            if tip[2]<z and (abs(tip[1]-self.center[1])>.0015 or abs(tip[0]-self.center[0])>self.radius+.0015):
                self.failure='off_path_penetration'
            for c in self.data.contact:
                names=[self.model.geom(int(g)).name for g in [c.geom1,c.geom2]]
                if 'floor' in names and any(n.startswith('needle_') for n in names): self.unwanted+=1; self.failure='floor_contact'
        self.steps+=1; self._jaws()
        good=self.entered and self.exited and self.caught and self.receiver and not self.donor and self.clear and self.gap<.0007 and np.linalg.norm(self.v)<.035 and not self.failure
        self.stable=self.stable+1 if good else 0
        success=self.stable>=15; done=bool(success or self.failure); truncated=self.steps>=500 and not done
        info=dict(success=bool(success),termination='success' if success else self.failure or ('timeout' if truncated else 'running'),steps=self.steps,
                  entered=self.entered,exited=self.exited,caught=self.caught,receiver_holding=self.receiver,donor_holding=self.donor,
                  needle_clear=self.clear,wound_gap_m=self.gap,initial_gap_m=self.config['gap'],tension_n=self.tension,
                  entry_error_m=self.entry_error,exit_error_m=self.exit_error,unwanted_collisions=self.unwanted)
        return self.observation(),float(success),done,truncated,info

    def state(self): return np.r_[self.data.qpos,self.data.qvel,self.data.ctrl,self.closure,self.data.mocap_pos.ravel()]
