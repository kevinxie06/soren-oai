# Model credits

## Patient face

**Infinite, 3D Head Scan by Lee Perry-Smith**, based on work at
[triplegangers.com](https://www.triplegangers.com/), distributed with the
[Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/LeePerrySmith).
Licensed under [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
Original notice: [LeePerrySmith_License.txt](patient/LeePerrySmith_License.txt).

The source mesh and textures are retained; presentation changes include scale,
placement, physical skin material and normal strength. The face is used as a visual
stand-in for an adult patient. It does not depict the scanned person undergoing a
procedure. The draped torso/limbs are procedural, not scan-derived anatomy.

## Robot

**Franka Emika Panda** meshes and kinematic description from
[Google DeepMind MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/main/franka_emika_panda),
derived from the [Franka ROS description](https://github.com/frankaemika/franka_ros/tree/develop/franka_description).
Licensed under [Apache 2.0](robot/LICENSE).

Modified for this viewer: converted the MJCF visual meshes into `robot/panda.glb`,
adjusted materials, placed the base, and added inverse-kinematics joint animation.
The robot is a research manipulator used for visualization, not a validated surgical
system. No endorsement by the asset authors or robot manufacturer is implied.

## Reproducibility

[sources.json](sources.json) records pinned upstream URLs and SHA-256 hashes.
[fit-report.json](robot/fit-report.json) records the exact motion hash and fitting
errors. The source meshes are downloaded into `artifacts/asset-source/panda` by
`scripts/fetch-surgical-assets.py`; conversion is implemented in
`scripts/build-robot-presentation.py`.

Room, drapes, covered body, operative field and illustrative organ geometry were
created for this project. Rendering fidelity alone does not establish policy quality.
