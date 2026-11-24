# SPDX-License-Identifier: GPL-3.0-or-later
"""Capture native evaluated controls and camera after zero Object or bone scales."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', SOURCE / '__init__.py',
                                            submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = spec.name
bpy.context.preferences.edit.object_align = 'WORLD'
# Axis conversion is exact; a float32 trigonometric quarter-turn adds residue to zero axes.
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def flat(matrix):
    return [matrix[row][column] for column in range(4) for row in range(4)]


cases = []
offsets = {}
for kind in ['DOLLY', 'CRANE', '2D']:
    for owner in ['Object', 'Root', 'Camera']:
        for scale in [(0, 0, 0), (1.2, 0, 1.1)]:
            bpy.ops.object.select_all(action='SELECT')
            bpy.ops.object.delete(use_global=False)
            bpy.context.scene.cursor.location = (2.1, -1.3, 0.6)
            bpy.context.scene.render.resolution_x = 2560
            bpy.context.scene.render.resolution_y = 1440
            bpy.ops.object.build_camera_rig(mode=kind)
            rig = bpy.context.object
            camera = next(o for o in rig.children if o.type == 'CAMERA')
            if kind not in offsets:
                offsets[kind] = {}
                for p in rig.pose.bones:
                    if not p.parent:
                        continue
                    offset = p.bone.matrix.to_4x4()
                    offset.translation = p.bone.head
                    offset.translation.y += p.parent.bone.length
                    offsets[kind][p.name] = flat(offset)
            target = rig if owner == 'Object' else rig.pose.bones[owner]
            target.rotation_euler = (0.23, -0.37, 0.41)
            target.scale = scale
            bpy.context.view_layer.update()
            graph = bpy.context.evaluated_depsgraph_get()
            erig = rig.evaluated_get(graph)
            ecam = camera.evaluated_get(graph)
            controls = {}
            for p in rig.pose.bones:
                if p.name.startswith('MCH-'):
                    continue
                ep = erig.pose.bones[p.name]
                shape = erig.pose.bones[p.custom_shape_transform.name].matrix if p.custom_shape_transform else ep.matrix
                offset = Matrix.LocRotScale(p.custom_shape_translation, p.custom_shape_rotation_euler.to_quaternion(), p.custom_shape_scale_xyz * (p.bone.length if p.use_custom_shape_bone_size else 1)) if p.custom_shape else Matrix.Identity(4)
                controls[p.name] = dict(matrix=flat(C @ shape @ offset),
                                       boneMatrix=flat(C @ ep.matrix))
            parent = erig.pose.bones[camera.parent_bone]
            local_camera = C @ parent.matrix @ Matrix.Translation((0, parent.bone.length, 0)) @ camera.matrix_basis
            focus = ecam.data.dof.focus_distance
            if ecam.data.dof.focus_object:
                subject = erig.matrix_world @ erig.pose.bones[ecam.data.dof.focus_subtarget].matrix.translation
                focus = abs((ecam.matrix_world.translation - subject).dot(ecam.matrix_world.col[2].to_3d().normalized()))
            cases.append(dict(type={'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind],
                              owner=owner, scale=list(scale),
                              worldMatrix=flat(C @ erig.matrix_world @ C.inverted()),
                              cameraMatrix=flat(local_camera), worldCameraMatrix=flat(C @ ecam.matrix_world),
                              controls=controls,
                              focusDistance=max(1e-5, focus), lens=ecam.data.lens,
                              bones={p.name: dict(location=list(p.location), rotation=list(p.rotation_euler),
                                                 scale=list(p.scale), properties={key: float(value) for key, value in p.items() if isinstance(value, (int, float)) and key != 'lens_without_breathing'})
                                     for p in rig.pose.bones if not p.name.startswith('MCH-')}))

result = dict(blender=bpy.app.version_string, buildHash=bpy.app.build_hash.decode(),
              source='add-camera-rigs@1.9.0',
              sourceSHA256=hashlib.sha256((SOURCE / 'build_rigs.py').read_bytes()).hexdigest(),
              cases=cases)
output = ROOT / 'tests/integration/fixtures/add-camera-rigs-zero-scale.json'
output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
offset_source = {
    'source': result['source'], 'blender': result['blender'], 'buildHash': result['buildHash'],
    'sourceSHA256': result['sourceSHA256'],
    'function': 'BKE_bone_offset_matrix_get',
    'offsets': {{'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind]: value for kind, value in offsets.items()},
}
if '--fixtures-only' not in sys.argv:
    (ROOT / 'packages/viewer/src/lib/add-camera-rigs-offsets-source.ts').write_text(
        '// SPDX-License-Identifier: GPL-3.0-or-later\n'
        '// Generated by scripts/blender/export-camera-rig-zero-scale.py from the original rig.\n'
        'export const nativeRigOffsets = ' + json.dumps(offset_source, indent=2) + '\n')
print(f'Exported {len(cases)} native zero-scale cases')
