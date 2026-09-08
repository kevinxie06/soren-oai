"""Derive a subtle skin-detail map from the existing attributed head/neck scan."""
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter
import numpy as np

source=Path('public/models/patient/Map-COL.jpg')
crop=Image.open(source).convert('RGB').crop((60,680,260,850))
# Remove broad baked lighting; retain local pigmentation and fine photographic detail.
pixels=np.asarray(crop,dtype=float)
low=np.asarray(crop.filter(ImageFilter.GaussianBlur(18)),dtype=float)
detail=np.clip(205+(pixels-low)*1.1,130,245).astype('uint8')
tile=Image.fromarray(detail)
canvas=Image.new('RGB',(400,340))
canvas.paste(tile,(0,0));canvas.paste(ImageOps.mirror(tile),(200,0))
canvas.paste(ImageOps.flip(tile),(0,170));canvas.paste(ImageOps.flip(ImageOps.mirror(tile)),(200,170))
out=Path('public/models/stitch');out.mkdir(parents=True,exist_ok=True)
canvas.save(out/'skin-detail.jpg',quality=95)
(out/'ATTRIBUTION.md').write_text('''# Suturing presentation material

Skin-detail texture derived from a neck region of **Infinite, 3D Head Scan by Lee Perry-Smith**, based on triplegangers.com work, distributed in the Three.js examples under CC BY 3.0.

Source: ../patient/Map-COL.jpg. Original license: ../patient/LeePerrySmith_License.txt. The source URL/hash is retained in ../sources.json.

Changes: crop (60,680)-(260,850), remove broad illumination, convert to neutral detail modulation, mirror at tile edges. Rebuild with `python scripts/build-stitch-material.py`.

This is a material study on a synthetic wound, not footage or a depiction of the scanned person undergoing a procedure. All other suturing scene geometry is procedurally authored in app/suturing/scene.ts.
''')
