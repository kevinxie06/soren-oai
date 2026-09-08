"""Run python -m examples.stitch_inference; imports no teacher."""
import argparse
import json
from stitch.env import StitchEnv
from stitch.policy import Policy


def main():
    p=argparse.ArgumentParser(); p.add_argument('--checkpoint',default='artifacts/stitch/policy.npz'); p.add_argument('--seed',type=int,default=30000)
    args=p.parse_args(); env=StitchEnv(); obs=env.reset(args.seed); policy=Policy(args.checkpoint)
    while True:
        obs,_,done,truncated,info=env.step(policy.act(obs))
        if done or truncated: print(json.dumps(info,indent=2)); break


if __name__=='__main__': main()
