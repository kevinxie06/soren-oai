"""Run from repository root: python -m examples.inference --checkpoint ..."""
import argparse
from bootstrap.env import ExtractionEnv
from bootstrap.policy import Policy


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--checkpoint',default='artifacts/policy.npz')
    parser.add_argument('--seed',type=int,default=20000)
    args=parser.parse_args()
    env=ExtractionEnv()
    policy=Policy(args.checkpoint)
    obs=env.reset(seed=args.seed)
    while True:
        obs,reward,terminated,truncated,info=env.step(policy.act(obs))
        if terminated or truncated:
            print(info)
            break

if __name__=='__main__': main()
