import numpy as np
import mujoco

DT = 0.05
MAX_DELTA = 0.012
VERSION = 'gantry-v1'
OBS_NAMES = ([f'ee_{a}' for a in 'xyz'] + [f'object_{a}' for a in 'xyz']
             + [f'tray_{a}' for a in 'xyz'] + [f'object_minus_ee_{a}' for a in 'xyz']
             + [f'tray_minus_object_{a}' for a in 'xyz']
             + [f'ee_velocity_{a}' for a in 'xyz'] + [f'object_velocity_{a}' for a in 'xyz']
             + ['closed', 'attached', 'cleared', 'released']
             + [f'object_quaternion_{a}' for a in ['w','x','y','z']]
             + [f'object_angular_velocity_{a}' for a in 'xyz'])

def scene(seed):
    r = np.random.default_rng(seed)
    return dict(seed=int(seed), object_xy=r.uniform(-.022, .022, 2).tolist(),
                object_yaw=float(r.uniform(-.15, .15)),
                tray_xy=[float(r.uniform(.25,.32)),float(r.uniform(-.045,.045))],
                ee_xy=r.uniform(-.025,.025,2).tolist())

def xml(c):
    tx,ty = c['tray_xy']
    walls = ''
    for prefix,x,y,half,height in [('cavity',0,0,.085,.10),('tray',tx,ty,.085,.035)]:
        for i,(dx,dy,sx,sy) in enumerate([(half,0,.007,half),( -half,0,.007,half),(0,half,half,.007),(0,-half,half,.007)]):
            walls += f'<geom name="{prefix}_wall{i}" type="box" pos="{x+dx} {y+dy} {height/2}" size="{sx} {sy} {height/2}" rgba=".45 .55 .65 1"/>'
    return f'''<mujoco model="extraction"><compiler angle="radian"/><option timestep=".002" integrator="implicitfast"/>
    <default><geom friction="1 .01 .001" solref=".008 1"/><joint damping="10"/></default>
    <visual><global offwidth="800" offheight="600"/></visual>
    <worldbody><light pos="0 -1 2"/><camera name="overview" pos=".75 -.95 .8" xyaxes=".8 .6 0 -.3 .4 .866"/>
    <geom name="floor" type="plane" size="1 1 .05" rgba=".18 .22 .25 1"/>
    <geom name="tray_floor" type="box" pos="{tx} {ty} .005" size=".085 .085 .005" rgba=".15 .6 .45 1"/>{walls}
    <body name="ee" pos="0 0 0" gravcomp="1">
    <joint name="x" type="slide" axis="1 0 0"/><joint name="y" type="slide" axis="0 1 0"/><joint name="z" type="slide" axis="0 0 1"/>
    <geom name="palm" type="box" pos="0 0 .065" size=".047 .018 .01" mass=".4" rgba=".7 .75 .8 1"/>
    <body name="left" pos="-.038 0 .015"><joint name="left_finger" type="slide" axis="1 0 0" range="0 .013" limited="true"/><geom name="finger_l" type="box" size=".005 .018 .04" mass=".05" rgba=".2 .3 .8 1"/></body>
    <body name="right" pos=".038 0 .015"><joint name="right_finger" type="slide" axis="-1 0 0" range="0 .013" limited="true"/><geom name="finger_r" type="box" size=".005 .018 .04" mass=".05" rgba=".2 .3 .8 1"/></body></body>
    <body name="heart" pos="0 0 .026"><freejoint name="object"/>
    <geom name="object_collision" type="box" size=".023 .025 .025" mass=".07" rgba=".8 .08 .15 0"/>
    <geom type="ellipsoid" pos="-.011 .007 .003" size=".017 .021 .024" contype="0" conaffinity="0" mass="0" rgba=".85 .05 .13 1"/>
    <geom type="ellipsoid" pos=".011 .007 .003" size=".017 .021 .024" contype="0" conaffinity="0" mass="0" rgba=".85 .05 .13 1"/>
    <geom type="ellipsoid" pos="0 -.012 0" size=".018 .022 .02" contype="0" conaffinity="0" mass="0" rgba=".85 .05 .13 1"/>
    </body></worldbody>
    <equality><weld name="grasp" body1="ee" body2="heart" active="false" solref=".004 1"/></equality>
    <actuator><position joint="x" kp="1800" kv="85"/><position joint="y" kp="1800" kv="85"/><position joint="z" kp="1800" kv="85"/>
    <position joint="left_finger" kp="120"/><position joint="right_finger" kp="120"/></actuator></mujoco>'''

class ExtractionEnv:
    """20 Hz world-frame delta XYZ + close/open command; shared assisted grasp."""
    def reset(self, seed=0, config=None):
        self.config = config or scene(seed)
        self.model = mujoco.MjModel.from_xml_string(xml(self.config))
        self.data = mujoco.MjData(self.model)
        self.obj_q = self.model.joint('object').qposadr[0]
        self.obj_v = self.model.joint('object').dofadr[0]
        self.data.qpos[:3] = [*self.config['ee_xy'], .20]
        q = self.obj_q
        self.data.qpos[q:q+3] = [*self.config['object_xy'], .026]
        yaw = self.config['object_yaw']
        self.data.qpos[q+3:q+7] = [np.cos(yaw/2),0,0,np.sin(yaw/2)]
        self.data.ctrl[:3] = self.data.qpos[:3]
        self.closed = self.attached = self.cleared = self.released = False
        self.steps = self.stable = self.unwanted = self.drops = 0
        self._contact_pairs = set()
        mujoco.mj_forward(self.model,self.data)
        for _ in range(100): mujoco.mj_step(self.model,self.data)
        return self.observation()

    @property
    def ee(self): return self.data.qpos[:3].copy()
    @property
    def obj(self): return self.data.qpos[self.obj_q:self.obj_q+3].copy()
    @property
    def target(self): return np.array([*self.config['tray_xy'], .035])

    def observation(self):
        return np.concatenate([self.ee,self.obj,self.target,self.obj-self.ee,self.target-self.obj,
            self.data.qvel[:3],self.data.qvel[self.obj_v:self.obj_v+3],
            [self.closed,self.attached,self.cleared,self.released],
            self.data.qpos[self.obj_q+3:self.obj_q+7], self.data.qvel[self.obj_v+3:self.obj_v+6]]).astype(np.float32)

    def in_tray(self):
        return bool(np.all(np.abs(self.obj[:2]-self.target[:2]) < .05) and abs(self.obj[2]-.035)<.012)

    def step(self, action):
        a = np.asarray(action, dtype=float)
        if a.shape != (4,) or not np.isfinite(a).all(): raise ValueError('Expected finite action shape (4,)')
        a = np.clip(a,-1,1)
        self.closed = bool(a[3]>0)
        if self.attached and not self.closed:
            self.attached=False; self.released=True; self.data.eq_active[0]=0
            if not self.in_tray(): self.drops += 1
        # A weld is enabled only after actual finger closure and close proximity.
        if (not self.attached and not self.released and self.closed and
            np.linalg.norm(self.obj-self.ee)<.012 and min(self.data.qpos[3:5])>.007):
            self.model.eq_data[0,3:6] = self.obj-self.ee
            self.model.eq_data[0,6:10] = self.data.qpos[self.obj_q+3:self.obj_q+7]
            self.data.eq_active[0]=1; self.attached=True
        self.data.ctrl[:3] = np.clip(self.ee+a[:3]*MAX_DELTA,[-.15,-.18,.025],[.45,.18,.35])
        self.data.ctrl[3:] = .013 if self.closed else 0
        for _ in range(25):
            mujoco.mj_step(self.model,self.data)
            pairs=set()
            for contact in self.data.contact:
                names=[mujoco.mj_id2name(self.model,mujoco.mjtObj.mjOBJ_GEOM,int(g)) or 'visual' for g in [contact.geom1,contact.geom2]]
                wall_contact = any(n.startswith(('finger','palm','object_collision')) for n in names) and any('wall' in n for n in names)
                floor_penetration = any(n.startswith(('finger','palm')) for n in names) and any(n in ('floor','tray_floor') for n in names) and contact.dist < -.001
                if wall_contact or floor_penetration:
                    pairs.add(tuple(sorted(names)))
            self.unwanted += len(pairs-self._contact_pairs)
            self._contact_pairs=pairs
            # Rotated box's lowest point must clear the rim while above cavity.
            mat=self.data.body('heart').xmat.reshape(3,3)
            bottom=self.obj[2]-np.dot(np.abs(mat[2]),[.023,.025,.025])
            if self.attached and bottom>.105 and np.all(np.abs(self.obj[:2])<.06): self.cleared=True
        self.steps += 1
        speed=np.linalg.norm(self.data.qvel[self.obj_v:self.obj_v+6])
        good=self.cleared and self.released and not self.attached and not self.closed and self.in_tray() and speed<.04
        self.stable = self.stable+1 if good else 0
        success=self.stable>=15
        terminated=success or self.obj[2]<-.05
        truncated=self.steps>=240 and not terminated
        info=dict(success=success,termination='success' if success else ('out_of_bounds' if terminated else ('timeout' if truncated else 'running')),
                  drops=self.drops,unwanted_collisions=self.unwanted,placement_error=float(np.linalg.norm(self.obj[:2]-self.target[:2])),
                  cleared=self.cleared,released=self.released,steps=self.steps)
        return self.observation(), float(success), terminated, truncated, info

    def state(self):
        return np.concatenate([self.data.qpos,self.data.qvel,self.data.ctrl,self.data.eq_active])
