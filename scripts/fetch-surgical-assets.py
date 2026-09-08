"""Fetch attributed source assets; all outputs stay inside this repository."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "soren-asset-build"}), timeout=90).read()

def save(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(get(url))
    return {"path": str(path.relative_to(ROOT)), "url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}

def main():
    lock = ROOT / "public/models/sources.json"
    if lock.exists():
        records = json.loads(lock.read_text())
        for record in records:
            path = (ROOT / record["path"]).resolve()
            if not path.is_relative_to(ROOT):
                raise ValueError("Asset destination escapes the repository")
            result = save(record["url"], path)
            if result["sha256"] != record["sha256"]:
                raise ValueError(f"Pinned source changed: {path}")
        license_out = ROOT / "public/models/robot/LICENSE"
        license_out.parent.mkdir(parents=True, exist_ok=True)
        license_out.write_bytes((ROOT / "artifacts/asset-source/panda/LICENSE").read_bytes())
        print(f"Verified {len(records)} pinned source files", flush=True)
        return
    manifest = []
    head_repo = "mrdoob/three.js"
    head_sha = json.loads(get(f"https://api.github.com/repos/{head_repo}/commits/dev"))["sha"]
    head_dir = "examples/models/gltf/LeePerrySmith"
    files = json.loads(get(f"https://api.github.com/repos/{head_repo}/contents/{head_dir}?ref={head_sha}"))
    for f in files:
        if f["type"] == "file":
            manifest.append(save(f["download_url"], ROOT / "public/models/patient" / f["name"]))
    repo = "google-deepmind/mujoco_menagerie"
    sha = json.loads(get(f"https://api.github.com/repos/{repo}/commits/main"))["sha"]
    base = f"https://raw.githubusercontent.com/{repo}/{sha}/franka_emika_panda/"
    folder = ROOT / "artifacts/asset-source/panda"
    for name in ["panda.xml", "LICENSE", "README.md"]:
        manifest.append(save(base + name, folder / name))
    xml = ET.parse(folder / "panda.xml")
    names = [m.attrib["file"] for m in xml.findall("./asset/mesh")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        manifest.extend(pool.map(lambda name: save(base + "assets/" + name, folder / "assets" / name), names))
    license_out = ROOT / "public/models/robot/LICENSE"
    license_out.parent.mkdir(parents=True, exist_ok=True)
    license_out.write_bytes((folder / "LICENSE").read_bytes())
    (ROOT / "public/models/sources.json").write_text(json.dumps(manifest, indent=2))
    print(f"Downloaded and hashed {len(manifest)} source files", flush=True)

if __name__ == "__main__":
    main()
