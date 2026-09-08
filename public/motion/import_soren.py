"""Unreal Editor Python importer, targeting UE 5.7. Run inside an empty editor level.
import_soren.import_recording(r'C:/path/heart.json')
"""
import json
import math
from pathlib import Path


def unwrap_degrees(previous, current):
    return previous + ((current - previous + 180) % 360 - 180)


def import_recording(path, with_context=True):
    import unreal
    data=json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if data['schema_version']!='soren.motion.v1': raise ValueError('Unsupported motion schema')
    asset_tools=unreal.AssetToolsHelpers.get_asset_tools()
    _,name=asset_tools.create_unique_asset_name('/Game/Soren/HeartPlayback','')
    folder='/Game/Soren'
    level_path=f'{folder}/{name}_Map'
    if not unreal.EditorLevelLibrary.new_level(level_path): raise RuntimeError('Could not create a new playback level')
    sequence=asset_tools.create_asset(name,folder,unreal.LevelSequence,unreal.LevelSequenceFactoryNew())
    sequence.set_display_rate(unreal.FrameRate(data['sample_hz'],1))
    sequence.set_playback_start(0); sequence.set_playback_end(len(data['frames']))
    actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    meshes={s:unreal.load_asset('/Engine/BasicShapes/'+m) for s,m in [('box','Cube'),('plane','Plane'),('sphere','Sphere'),('ellipsoid','Sphere')]}
    materials={}

    def material(rgb):
        key=tuple(round(float(v),3) for v in rgb)
        if key not in materials:
            mat=asset_tools.create_asset(f'{name}_Material_{len(materials)}',folder,unreal.Material,unreal.MaterialFactoryNew())
            color=unreal.MaterialEditingLibrary.create_material_expression(mat,unreal.MaterialExpressionConstant3Vector)
            color.set_editor_property('constant',unreal.LinearColor(*key,1.0))
            unreal.MaterialEditingLibrary.connect_material_property(color,'',unreal.MaterialProperty.MP_BASE_COLOR)
            unreal.MaterialEditingLibrary.recompile_material(mat); materials[key]=mat
        return materials[key]

    def spawn(label,shape,half_size,rgb,pose):
        actor=actors.spawn_actor_from_class(unreal.StaticMeshActor,unreal.Vector(*pose['location_cm']))
        actor.set_actor_label(label)
        component=actor.static_mesh_component
        component.set_mobility(unreal.ComponentMobility.MOVABLE)
        component.set_static_mesh(meshes[shape]); component.set_material(0,material(rgb))
        component.set_simulate_physics(False); actor.set_actor_enable_collision(False)
        scale=[2*float(x) for x in half_size]
        if shape=='plane': scale[2]=1
        if shape=='sphere': scale=[scale[0]]*3
        actor.set_actor_scale3d(unreal.Vector(*scale))
        actor.set_actor_rotation(unreal.Quat(*pose['quaternion_xyzw']).rotator(),False)
        return actor

    for i,g in enumerate(data['geometry']):
        if g['rgba'][3]<=0 or (with_context and g['name']=='floor'): continue
        actor=spawn(g['name'],g['shape'],g['half_size_m'],g['rgba'][:3],data['frames'][0]['poses'][i]['unreal'])
        if not g['dynamic']: continue
        binding=sequence.add_possessable(actor)
        track=binding.add_track(unreal.MovieScene3DTransformTrack); section=track.add_section()
        section.set_range(0,len(data['frames']))
        channels=section.get_all_channels()
        if len(channels)!=9: raise RuntimeError('Expected nine transform channels; check Sequencer Scripting plugin/version')
        scale=actor.get_actor_scale3d()
        for channel,value in zip(channels[6:],[scale.x,scale.y,scale.z]): channel.set_default(value)
        previous=None
        for frame_index,frame in enumerate(data['frames']):
            pose=frame['poses'][i]['unreal']; r=unreal.Quat(*pose['quaternion_xyzw']).rotator()
            angles=[r.roll,r.pitch,r.yaw]
            if previous is not None: angles=[unwrap_degrees(a,b) for a,b in zip(previous,angles)]
            previous=angles
            for channel,value in zip(channels[:6],pose['location_cm']+angles):
                channel.add_key(unreal.FrameNumber(frame_index),float(value),interpolation=unreal.MovieSceneKeyInterpolation.LINEAR)
    if with_context:
        for g in data['presentation_context']:
            p=g['position_m']; rgb=[int(g['color'][n:n+2],16)/255 for n in (1,3,5)]
            spawn('Decorative_'+g['name'],g['shape'],g['half_size_m'],rgb,
                  dict(location_cm=[p[0]*100,-p[1]*100,p[2]*100],quaternion_xyzw=[0,0,0,1]))
    light=actors.spawn_actor_from_class(unreal.DirectionalLight,unreal.Vector(0,0,180))
    light.set_actor_rotation(unreal.Rotator(-60,0,-30),False)
    actors.spawn_actor_from_class(unreal.SkyLight,unreal.Vector(0,0,200))
    camera=actors.spawn_actor_from_class(unreal.CineCameraActor,unreal.Vector(95,95,90))
    camera.set_actor_rotation(unreal.MathLibrary.find_look_at_rotation(camera.get_actor_location(),unreal.Vector(9,-9,1)),False)
    camera.get_cine_camera_component().set_editor_property('current_focal_length',35.0)
    camera_binding=sequence.add_possessable(camera)
    cuts=sequence.add_track(unreal.MovieSceneCameraCutTrack); cut=cuts.add_section(); cut.set_range(0,len(data['frames']))
    binding_id=unreal.MovieSceneObjectBindingID(); binding_id.set_editor_property('guid',camera_binding.get_id()); cut.set_camera_binding_id(binding_id)
    unreal.EditorAssetLibrary.save_directory(folder)
    unreal.EditorLevelLibrary.save_current_level()
    unreal.LevelSequenceEditorBlueprintLibrary.open_level_sequence(sequence)
    unreal.log(f'Soren imported {len(data["frames"])} measured samples. Decorative patient only. Sequence: {sequence.get_path_name()}')
    return sequence
