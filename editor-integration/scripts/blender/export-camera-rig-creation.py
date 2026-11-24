# SPDX-License-Identifier: GPL-3.0-or-later
"""Capture original Add Camera Rigs creation without converting an existing camera."""
import bpy
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location(
    'add_camera_rigs', SOURCE / '__init__.py', submodule_search_locations=[str(SOURCE)]
)
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
bpy.context.preferences.edit.object_align = 'WORLD'
C = Matrix.Rotation(-math.pi / 2, 4, 'X')


def flat(matrix):
    return [matrix[row][column] for column in range(4) for row in range(4)]


cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    for cursor, resolution in [
        ([0, 0, 0], [1920, 1080]),
        ([2.25, 3.5, -4.75], [1080, 1920]),
        ([-3, 1.25, 2], [1600, 1200]),
    ]:
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        bpy.context.scene.cursor.location = C.inverted() @ Vector(cursor)
        bpy.context.scene.cursor.rotation_euler = (0.2, -0.35, 0.4)
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = resolution
        bpy.context.scene.render.pixel_aspect_x = 1
        bpy.context.scene.render.pixel_aspect_y = 1
        result = bpy.ops.object.build_camera_rig(mode=kind)
        assert result == {'FINISHED'}
        rig = bpy.context.active_object
        camera = next(child for child in rig.children if child.type == 'CAMERA')
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        evaluated = camera.evaluated_get(graph)
        controls = [p for p in rig.pose.bones if not p.name.startswith('MCH-')]
        cases.append({
            'type': {'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind],
            'cursor': cursor,
            'resolution': resolution,
            'mode': bpy.context.mode,
            'activeIsRig': bpy.context.active_object == rig,
            'selectedObjects': ['rig' if o == rig else 'camera' if o == camera else o.name
                                for o in bpy.context.selected_objects],
            'sceneCameraIsCreatedCamera': bpy.context.scene.camera == camera,
            'activeBone': rig.data.bones.active.name if rig.data.bones.active else None,
            'selectedControls': [p.name for p in controls
                                 if getattr(p, 'select', getattr(p.bone, 'select', False))],
            'placement': flat(C @ rig.matrix_world @ C.inverted()),
            'cameraMatrix': flat(C @ evaluated.matrix_world),
            'projectionMatrix': flat(evaluated.calc_matrix_camera(
                graph, x=resolution[0], y=resolution[1], scale_x=1, scale_y=1
            )),
            'cameraDefaults': {
                'projection': 'orthographic' if camera.data.type == 'ORTHO' else 'perspective',
                'sensorWidth': camera.data.sensor_width,
                'near': camera.data.clip_start,
                'far': camera.data.clip_end,
                'orthoScale': camera.data.ortho_scale,
                'depthOfField': camera.data.dof.use_dof,
                'focusDistance': camera.data.dof.focus_distance,
                'aperture': camera.data.dof.aperture_fstop,
                'showInFront': rig.show_in_front,
                'lockCamera': camera.hide_select,
                'focusBone': camera.data.dof.focus_subtarget or None,
            },
            'lens': evaluated.data.lens,
            'bones': {
                p.name: {
                    'location': list(p.location),
                    'rotation': list(p.rotation_euler),
                    'scale': list(p.scale),
                    'properties': {key: float(value) for key, value in p.items()
                                   if isinstance(value, (int, float)) and key != 'lens_without_breathing'},
                }
                for p in controls
            },
        })
        bpy.ops.object.mode_set(mode='POSE')
        enter_pose = {
            'mode': bpy.context.mode,
            'activeBone': rig.data.bones.active.name if rig.data.bones.active else None,
            'selectedControls': [p.name for p in controls if p.select],
        }
        for p in rig.pose.bones:
            p.select = p.name == 'Camera'
        rig.data.bones.active = rig.data.bones['Camera']
        area = next(area for area in bpy.context.screen.areas if area.type == 'VIEW_3D')
        region = next(region for region in area.regions if region.type == 'WINDOW')
        with bpy.context.temp_override(area=area, region=region):
            bpy.ops.transform.translate(value=(0.7, -0.2, 0.3), orient_type='GLOBAL')
        pose_location = list(rig.pose.bones['Camera'].location)
        bpy.ops.object.mode_set(mode='OBJECT')
        cases[-1]['modeTransitions'] = {
            'enterPose': enter_pose,
            'posedCameraLocation': pose_location,
            'exitMode': bpy.context.mode,
            'exitCameraLocation': list(rig.pose.bones['Camera'].location),
            'exitActiveBone': rig.data.bones.active.name if rig.data.bones.active else None,
            'exitSelectedControls': [p.name for p in controls if p.select],
        }

metadata = {
    'blender': bpy.app.version_string,
    'buildHash': bpy.app.build_hash.decode(),
    'source': 'add-camera-rigs@1.9.0',
    'alignment': 'WORLD',
    'objectWireColors': {
        'active': list(bpy.context.preferences.themes[0].view_3d.object_active),
        'select': list(bpy.context.preferences.themes[0].view_3d.object_selected),
        'normal': list(bpy.context.preferences.themes[0].view_3d.wire),
        'transform': list(bpy.context.preferences.themes[0].view_3d.transform),
    },
    'sources': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(SOURCE.glob('*.py'))},
    'cases': cases,
}
output = ROOT / 'tests/integration/fixtures/add-camera-rigs-creation.json'
output.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + '\n')
defaults = cases[0]['cameraDefaults'].copy()
defaults.pop('focusBone')
source_defaults = ROOT / 'packages/editor/src/components/scene-camera/rig-create-defaults-source.json'
source_defaults.write_text(json.dumps({
    'source': metadata['source'],
    'blender': metadata['blender'],
    'buildHash': metadata['buildHash'],
    'operator': 'object.build_camera_rig',
    'sourcePath': 'vendor/add-camera-rigs/build_rigs.py',
    'sourceSHA256': metadata['sources']['vendor/add-camera-rigs/build_rigs.py'],
    'cameraDefaults': defaults,
    'objectWireColors': metadata['objectWireColors'],
}, indent=2) + '\n')
print('Exported', len(cases), 'original camera rig creation cases')
