# Suturing presentation material

Skin-detail texture derived from a neck region of **Infinite, 3D Head Scan by Lee Perry-Smith**, based on triplegangers.com work, distributed in the Three.js examples under CC BY 3.0.

Source: ../patient/Map-COL.jpg. Original license: ../patient/LeePerrySmith_License.txt. The source URL/hash is retained in ../sources.json.

Changes: crop (60,680)-(260,850), remove broad illumination, convert to neutral detail modulation, mirror at tile edges. Rebuild with `python scripts/build-stitch-material.py`.

This is a material study on a synthetic wound, not footage or a depiction of the scanned person undergoing a procedure. All other suturing scene geometry is procedurally authored in app/suturing/scene.ts.
