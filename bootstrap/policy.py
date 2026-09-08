import json
from pathlib import Path
import numpy as np

class Network:
    def __init__(self, obs_dim=32, width=64, seed=7):
        r=np.random.default_rng(seed)
        self.params={}
        for i,(a,b) in enumerate([(obs_dim,width),(width,width),(width,4)]):
            self.params[f'w{i}']=(r.normal(size=(a,b))*np.sqrt(1/a)).astype(np.float32)
            self.params[f'b{i}']=np.zeros(b,np.float32)
    def forward(self,x):
        p=self.params
        h1=np.tanh(x@p['w0']+p['b0']); h2=np.tanh(h1@p['w1']+p['b1'])
        return h2@p['w2']+p['b2'],(x,h1,h2)
    def loss_grad(self,x,y):
        out,(x,h1,h2)=self.forward(x); n=len(x)
        prob=1/(1+np.exp(-np.clip(out[:,3],-40,40))); target=(y[:,3]+1)/2
        loss=np.mean((out[:,:3]-y[:,:3])**2)+.3*np.mean(np.logaddexp(0,out[:,3])-target*out[:,3])
        g=np.zeros_like(out); g[:,:3]=2*(out[:,:3]-y[:,:3])/(n*3); g[:,3]=.3*(prob-target)/n
        grads={}
        for i,h in [(2,h2),(1,h1),(0,x)]:
            grads[f'w{i}']=h.T@g; grads[f'b{i}']=g.sum(0)
            if i: g=(g@self.params[f'w{i}'].T)*(1-h*h)
        return float(loss),grads

class Policy:
    def __init__(self,path='artifacts/policy.npz'):
        ck=np.load(path,allow_pickle=False)
        self.model=Network(len(ck['mean']),ck['w0'].shape[1])
        self.model.params={k:ck[k] for k in self.model.params}
        self.mean=ck['mean']; self.std=ck['std']
    def act(self,observation):
        out,_=self.model.forward((np.asarray(observation,np.float32)-self.mean)/self.std)
        return np.r_[np.clip(out[:3],-1,1),1. if out[3]>0 else -1.].astype(np.float32)

def train(dataset,output,epochs=180,seed=7):
    rng=np.random.default_rng(seed); train_eps=[]; val_eps=[]; train_seeds=[]; val_seeds=[]
    for f in sorted(Path(dataset).glob('episode_*.npz')):
        with np.load(f) as d:
            (val_seeds if int(d['seed'])%5==0 else train_seeds).append(int(d['seed']))
            (val_eps if int(d['seed'])%5==0 else train_eps).append((d['observations'][:-1],d['expert_actions'] if 'expert_actions' in d else d['actions']))
    if not train_eps or not val_eps: raise ValueError('Need training and validation episodes')
    x,y=map(np.concatenate,zip(*train_eps)); vx,vy=map(np.concatenate,zip(*val_eps))
    mean=x.mean(0); std=np.maximum(x.std(0),.02); x=(x-mean)/std; vx=(vx-mean)/std
    model=Network(x.shape[1],seed=seed)
    m={k:np.zeros_like(v) for k,v in model.params.items()}; v={k:np.zeros_like(v) for k,v in model.params.items()}
    history=[]; best=float('inf'); step=0; output=Path(output); output.parent.mkdir(parents=True,exist_ok=True)
    for epoch in range(epochs):
        indices=rng.permutation(len(x))
        for start in range(0,len(x),256):
            ix=indices[start:start+256]; loss,g=model.loss_grad(x[ix],y[ix]); step+=1
            for k in g:
                m[k]=.9*m[k]+.1*g[k]; v[k]=.999*v[k]+.001*g[k]**2
                model.params[k]-=.001*(m[k]/(1-.9**step))/(np.sqrt(v[k]/(1-.999**step))+1e-8)
        vl,_=model.loss_grad(vx,vy); history.append(vl)
        if vl<best:
            best=vl; np.savez(output,**model.params,mean=mean,std=std)
        if (epoch+1)%30==0: print(f'epoch {epoch+1}: validation loss {vl:.5f}',flush=True)
    config=dict(seed=seed,epochs=epochs,batch_size=256,optimizer='Adam',learning_rate=.001,
        architecture=dict(obs_dim=x.shape[1],hidden=[64,64],activation='tanh',output_dim=4,weights='row input @ weight + bias'),
        movement_loss='MSE',gripper_loss='0.3 * BCE logits',initialization='random; no pretrained weights',
        train_episodes=len(train_eps),validation_episodes=len(val_eps),train_frames=len(x),validation_frames=len(vx),
        split='scene seed modulo 5 == 0 for validation',
        training_targets='expert_actions when present, otherwise actions',
        dataset=str(dataset),train_scene_seeds=train_seeds,validation_scene_seeds=val_seeds,
        best_validation_loss=best,validation_history=history)
    output.with_suffix('.training.json').write_text(json.dumps(config,indent=2))
    output.with_suffix('.normalization.json').write_text(json.dumps(dict(mean=mean.tolist(),std=std.tolist()),indent=2))
    return config
