# Needle-lift verification result

Status: **blocked; not a verified learned policy**.

- NVIDIA task code, robot configuration, training/play scripts and scripted demonstrator downloaded.
- Robot, SDF needle and table USD root layers downloaded (41.99 MB total); hashes are in assets.json. External USD dependency closure remains unverified.
- No pretrained needle checkpoint found in the inspected official sources or 14 published release attachment lists.
- Direct upstream play attempt: exit 1, ModuleNotFoundError for isaaclab, before simulation startup.
- Local machine: Windows, Python 3.14.3, Intel Arc 140V; no NVIDIA runtime. Selected upstream setup requires Ubuntu, NVIDIA RTX hardware, Python 3.11, Isaac Sim 5.1.0 and Isaac Lab 2.3.0.
- Matching doctor/preview/evaluate/record commands ran and returned blocked JSON reports with success null. There is no locally simulated needle trajectory or preview recording.
- Seven tests passed, including three adapter checks. The heart checkpoint still completed seed 30000 successfully.

The adapter's supported-machine launch path remains unverified. Next step: obtain the exact trained needle-lift checkpoint with provenance/configuration and run upstream play on a compatible Ubuntu/RTX host. If weights cannot be obtained, training is a separately authorized task and was not started.

See ../../needle_lift/README.md for sources, version discrepancies, setup commands, interface differences and checkpoint metadata requirements.
