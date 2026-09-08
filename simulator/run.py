"""Soren Isaac Studio: a rendered Franka workcell + WebRTC + local control API.

Target: Isaac Sim 6.0.1. Run with Isaac Sim's python.sh, not system Python.
No Omniverse or USD modules may be imported before SimulationApp starts.
"""
from __future__ import annotations

import argparse
import ipaddress
import math
import os
from pathlib import Path
import secrets
import signal
import sys

from control import CommandError, ControlBridge, ControlServer


def port(value):
    number = int(value)
    if not 1 <= number <= 65535:
        raise argparse.ArgumentTypeError("Port must be between 1 and 65535.")
    return number


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-ip", default="127.0.0.1", help="GPU IPv4 address reachable by the browser; NOT 0.0.0.0")
    parser.add_argument("--control-host", default="127.0.0.1", help="Bind 0.0.0.0 for a browser on another machine")
    parser.add_argument("--control-port", type=port, default=8211)
    parser.add_argument("--signal-port", type=port, default=49100)
    parser.add_argument("--media-port", type=port, default=47998)
    parser.add_argument("--allow-origin", action="append", default=[], help="Additional exact frontend origin, e.g. http://192.168.1.50:3000")
    parser.add_argument("--scene", help="Existing USD environment to open instead of the Franka workcell")
    parser.add_argument("--robot-usd", help="Override the Franka USD asset location (same Panda articulation required)")
    parser.add_argument("--show-ui", action="store_true", help="Show Isaac Sim's editor UI in the stream")
    parser.add_argument("--smoke-test", action="store_true", help="Run actual GPU checks, write smoke-report.json, then exit")
    args = parser.parse_args()
    try:
        address = ipaddress.IPv4Address(args.public_ip)
        if address.is_unspecified or address.is_multicast:
            raise ValueError()
    except ValueError:
        parser.error("--public-ip must be a reachable IPv4 address, not 0.0.0.0.")
    if args.control_port == args.signal_port:
        parser.error("Control and signaling need separate TCP ports.")
    return args


def main():
    args = arguments()
    if sys.platform != "linux":
        raise SystemExit("Run the simulator on Ubuntu with an NVIDIA RTX GPU. Run the web app on your Mac and connect to that GPU host.")
    token = os.environ.get("ISAAC_CONTROL_TOKEN") or secrets.token_urlsafe(32)
    if len(token) < 16:
        raise SystemExit("ISAAC_CONTROL_TOKEN must contain at least 16 characters.")
    # Settings must be present before the livestream extension is enabled.
    from isaacsim import SimulationApp
    app = SimulationApp({
        "headless": True, "hide_ui": not args.show_ui,
        "width": 1920, "height": 1080, "window_width": 1920, "window_height": 1080,
        "renderer": "RealTimePathTracing", "sync_loads": True,
        "extra_args": [
            "--/exts/omni.kit.livestream.app/primaryStream/streamType=webrtc",
            f"--/exts/omni.kit.livestream.app/primaryStream/publicIp={args.public_ip}",
            f"--/exts/omni.kit.livestream.app/primaryStream/signalPort={args.signal_port}",
            f"--/exts/omni.kit.livestream.app/primaryStream/streamPort={args.media_port}",
            "--/app/runLoops/main/rateLimitEnabled=true",
            "--/app/runLoops/main/rateLimitFrequency=60",
        ],
    })
    server = None
    try:
        import numpy as np
        import omni.usd
        from pxr import Gf, UsdGeom, UsdLux, UsdPhysics
        from isaacsim.core.api import World
        from isaacsim.core.prims import SingleArticulation
        from isaacsim.core.utils.stage import add_reference_to_stage
        from isaacsim.core.utils.types import ArticulationAction
        from isaacsim.storage.native import get_assets_root_path
        from isaacsim.core.experimental.utils.app import enable_extension
        from omni.kit.viewport.utility import get_active_viewport

        app.set_setting("/app/window/drawMouse", True)
        enable_extension("omni.kit.livestream.app")
        if not app.app.get_extension_manager().is_extension_enabled("omni.kit.livestream.app"):
            raise RuntimeError("The NVIDIA livestream extension did not start. Check the full Isaac Sim installation and GPU encoder support.")
        bridge = ControlBridge()
        server = ControlServer(bridge, args.control_host, args.control_port, token,
            ["http://localhost:3000", "http://127.0.0.1:3000", *args.allow_origin])
        server.start()
        print(f"\nControl token: {token}\nControl API: http://{args.public_ip}:{args.control_port}\n", flush=True)

        context = omni.usd.get_context()
        if args.scene:
            if not context.open_stage(args.scene):
                raise RuntimeError(f"Could not open USD stage: {args.scene}")
        else:
            context.new_stage()
        stage = context.get_stage()
        if args.scene and (UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.z or abs(UsdGeom.GetStageMetersPerUnit(stage) - 1.0) > 1e-6):
            raise RuntimeError("Custom scenes must use Z-up and meters. Convert the asset in Isaac Sim before using --scene.")
        world = World(stage_units_in_meters=1.0, physics_dt=1 / 60, rendering_dt=1 / 60)
        robot = None
        home = np.array([0.0, -0.5, 0.0, -2.3, 0.0, 1.8, 0.8, 0.04, 0.04])
        camera = "overview"
        demo = False
        demo_phase = 0.0
        hold = home.copy()

        def box(path, position, scale, color):
            prim = UsdGeom.Cube.Define(stage, path)
            prim.CreateSizeAttr(1.0)
            prim.AddTranslateOp().Set(Gf.Vec3d(*position))
            prim.AddScaleOp().Set(Gf.Vec3f(*scale))
            prim.CreateDisplayColorAttr([Gf.Vec3f(*color)])
            UsdPhysics.CollisionAPI.Apply(prim.GetPrim())
            return prim

        if not args.scene:
            stage.SetDefaultPrim(UsdGeom.Xform.Define(stage, "/World").GetPrim())
            UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
            world.scene.add_default_ground_plane()
            box("/World/Pedestal", (-0.45, 0, 0.35), (0.38, 0.4, 0.7), (0.15, 0.2, 0.24))
            box("/World/Workbench", (0.5, 0, 0.65), (0.95, 1.3, 0.08), (0.28, 0.39, 0.43))
            for i, (x, y) in enumerate(((0.13, -0.5), (0.87, -0.5), (0.13, 0.5), (0.87, 0.5))):
                box(f"/World/Leg{i}", (x, y, 0.305), (0.06, 0.06, 0.61), (0.18, 0.23, 0.28))
            # A geometric training target, not anatomical or surgical tissue.
            box("/World/TrainingPad", (0.5, 0, 0.71), (0.38, 0.48, 0.04), (0.23, 0.5, 0.43))
            box("/World/Target", (0.45, 0.03, 0.76), (0.06, 0.06, 0.06), (0.75, 0.36, 0.25))
            root = get_assets_root_path() if not args.robot_usd else None
            if not root and not args.robot_usd:
                raise RuntimeError("NVIDIA assets are unavailable. Check network access or pass --robot-usd /local/path/franka.usd.")
            asset = args.robot_usd or root + "/Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd"
            add_reference_to_stage(asset, "/World/Franka")
            robot = world.scene.add(SingleArticulation(prim_path="/World/Franka", name="franka", position=np.array([-0.45, 0, 0.7])))
            robot.set_joints_default_state(positions=home)
            light = UsdLux.DomeLight.Define(stage, "/World/StudioLight")
            light.CreateIntensityAttr(1000)
            light.CreateColorAttr(Gf.Vec3f(0.82, 0.9, 1.0))
            area = UsdLux.RectLight.Define(stage, "/World/KeyLight")
            area.CreateIntensityAttr(1600)
            area.CreateWidthAttr(3)
            area.CreateHeightAttr(3)
            UsdGeom.Xformable(area).AddTranslateOp().Set(Gf.Vec3d(0, 0, 3.5))

        # Put viewer cameras in the session layer; custom USD files are never saved over.
        stage.SetEditTarget(stage.GetSessionLayer())
        bbox = UsdGeom.BBoxCache(0, [UsdGeom.Tokens.default_, UsdGeom.Tokens.render]).ComputeWorldBound(stage.GetPseudoRoot()).ComputeAlignedRange()
        center = bbox.GetMidpoint() if args.scene and not bbox.IsEmpty() else Gf.Vec3d(0.2, 0, 0.85)
        radius = max(1.0, bbox.GetSize().GetLength() * 0.6) if args.scene and not bbox.IsEmpty() else 2.4
        poses = {
            "overview": center + Gf.Vec3d(radius, -radius, radius * 0.7),
            "workbench": center + Gf.Vec3d(radius * 0.45, -radius * 0.5, radius * 0.35),
            "top": center + Gf.Vec3d(0, -0.01, radius * 1.3),
        }
        for name, eye in poses.items():
            cam = UsdGeom.Camera.Define(stage, f"/SorenViewer/{name}")
            cam.CreateClippingRangeAttr(Gf.Vec2f(0.01, 10000))
            cam.CreateFocalLengthAttr(24)
            transform = Gf.Matrix4d().SetLookAt(eye, center, Gf.Vec3d(0, 0, 1)).GetInverse()
            UsdGeom.Xformable(cam).AddTransformOp().Set(transform)
        viewport = get_active_viewport()
        if viewport is None:
            raise RuntimeError("No RTX viewport. Use the full Isaac Sim installation, not a minimal physics-only experience.")
        viewport.set_texture_resolution((1920, 1080))
        viewport.camera_path = "/SorenViewer/overview"
        world.reset()
        if robot:
            if robot.num_dof != 9:
                raise RuntimeError("Expected the 9-DOF Franka Panda asset for this demo.")
            robot.set_joint_positions(home)
        # Run a few rendered steps before advertising readiness; keep the scene paused initially.
        for _ in range(10):
            world.step(render=True)
        world.pause()

        def snapshot():
            positions = robot.get_joint_positions() if robot else []
            return {"ready": True, "running": world.is_playing(), "demo": demo,
                "camera": camera, "scene": "Custom USD environment" if args.scene else "Franka · workbench",
                "sim_time": float(world.current_time),
                "joints": [float(value) for value in positions],
                "joint_names": list(robot.dof_names) if robot else [],
                "capabilities": ["play", "pause", "reset", "camera"] + (["demo"] if robot else [])}

        def execute(command):
            nonlocal camera, demo, demo_phase, hold
            action = command["action"]
            if action == "play":
                world.play()
            elif action == "pause":
                world.pause()
            elif action == "reset":
                world.reset()
                demo, demo_phase, hold = False, 0.0, home.copy()
                if robot:
                    robot.set_joint_positions(home)
                    robot.set_joint_velocities(np.zeros(9))
                world.pause()
            elif action == "set_camera":
                camera = command["camera"]
                viewport.camera_path = f"/SorenViewer/{camera}"
            elif action == "set_demo":
                if not robot:
                    raise CommandError("Motion demo is available only in the included Franka scene.")
                demo = command["enabled"]
                if not demo:
                    hold = robot.get_joint_positions().copy()
                else:
                    world.play()
            bridge.publish(snapshot())
            return bridge.snapshot()

        bridge.publish(snapshot())
        print("Scene ready. Open http://localhost:3000, enter the GPU host and token, and connect.", flush=True)
        running = True

        def stop(*_):
            nonlocal running
            running = False

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        if args.smoke_test:
            import json
            initial = snapshot()
            execute({"action": "play"})
            for _ in range(60):
                world.step(render=True)
            assert snapshot()["sim_time"] > initial["sim_time"]
            execute({"action": "pause"})
            assert not snapshot()["running"]
            for preset in poses:
                execute({"action": "set_camera", "camera": preset})
                app.update()
                assert str(viewport.camera_path) == f"/SorenViewer/{preset}"
            execute({"action": "reset"})
            assert not snapshot()["running"]
            assert not snapshot()["demo"]
            if robot:
                assert np.allclose(robot.get_joint_positions(), home, atol=1e-3)
            report = {"passed": True, "state": bridge.snapshot(), "note": "GPU scene/control checks only; browser video must be checked separately."}
            report_path = Path(__file__).resolve().parent.parent / "smoke-report.json"
            report_path.write_text(json.dumps(report, indent=2))
            print(f"GPU smoke checks passed: {report_path}", flush=True)
            return
        while running and app.is_running():
            bridge.drain(execute)
            if world.is_playing() and robot:
                if demo:
                    demo_phase += 1 / 60
                    target = home.copy()
                    target[0] += 0.2 * math.sin(demo_phase * 0.65)
                    target[3] += 0.1 * math.sin(demo_phase * 0.65)
                    hold = target
                robot.apply_action(ArticulationAction(joint_positions=hold))
            world.step(render=True)
            bridge.publish(snapshot())
    finally:
        if server:
            server.close()
        app.close()


if __name__ == "__main__":
    main()
