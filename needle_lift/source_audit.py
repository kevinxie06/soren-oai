import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/needle_lift'
OUT.mkdir(parents=True,exist_ok=True)
BASE='https://omniverse-content-production.s3-us-west-2.amazonaws.com/Assets/Isaac/Healthcare/0.5.0/132c82d/'
rows=[]
for relative in ['Robots/dVRK/PSM/psm.usd','Props/SutureNeedle/needle_sdf.usd','Props/Table/table.usd']:
    dest=OUT/'assets'/relative; dest.parent.mkdir(parents=True,exist_ok=True)
    url=BASE+relative
    with urllib.request.urlopen(url,timeout=60) as response:
        data=response.read(); dest.write_bytes(data)
    rows.append(dict(url=url,path=str(dest.relative_to(ROOT)),bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),magic=data[:8].decode('ascii',errors='replace')))
(OUT/'assets.json').write_text(json.dumps(dict(root_layers=rows,dependency_closure_verified=False,runtime_resolution='Keep original upstream HTTPS URLs; cached root layers are not an offline asset bundle'),indent=2))
req=urllib.request.Request('https://api.github.com/repos/isaac-for-healthcare/i4h-workflows/releases?per_page=100',headers={'User-Agent':'needle-lift-source-audit'})
with urllib.request.urlopen(req,timeout=30) as response: releases=json.load(response)
summary=[dict(tag=r['tag_name'],url=r['html_url'],assets=[dict(name=a['name'],url=a['browser_download_url']) for a in r['assets']]) for r in releases]
(OUT/'release_assets.json').write_text(json.dumps(summary,indent=2))
up=ROOT/'upstream/i4h-workflows-v0.5.0'
script=up/'workflows/robotic_surgery/scripts/simulation/scripts/reinforcement_learning/rsl_rl/play.py'
cmd=[sys.executable,str(script),'--task','Isaac-Lift-Needle-PSM-IK-Rel-v0','--num_envs','1','--headless']
r=subprocess.run(cmd,cwd=up,text=True,capture_output=True,timeout=30)
(OUT/'upstream_attempt.log').write_text(r.stdout+r.stderr)
(OUT/'upstream_attempt.json').write_text(json.dumps(dict(command=cmd,returncode=r.returncode,simulation_started=False,success=None,note='Direct upstream play attempt; no checkpoint supplied because none was found. Import failed before checkpoint resolution.'),indent=2))
print(json.dumps(rows,indent=2)); print('Release assets:',summary); print('Upstream launch:',r.returncode,r.stderr)
