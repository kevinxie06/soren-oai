"""Teacher-free closed-loop inference: python -m examples.suturing_inference."""
import argparse
import json
from suturing.env import NeedleDriveEnv
from suturing.policy import Policy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', default='artifacts/suturing/policy.npz')
    parser.add_argument('--seed', type=int, default=20000)
    args = parser.parse_args()
    policy = Policy(args.checkpoint)
    env = NeedleDriveEnv()
    obs = env.reset(args.seed)
    while True:
        obs, reward, terminated, truncated, info = env.step(policy.act(obs))
        if terminated or truncated:
            print(json.dumps(info, indent=2))
            break


if __name__ == '__main__':
    main()
