# SPDX-License-Identifier: GPL-3.0-or-later
"""Run original Object-mode transform operators on unmodified Add Camera Rigs."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

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
C = Matrix.Rotation(-math.pi / 2, 4, 'X')


def flat(matrix):
    return [matrix[row][column] for column in range(4) for row in range(4)]


def bones(rig):
    return {p.name: dict(location=list(p.location), rotation=list(p.rotation_euler),
                         scale=list(p.scale), properties={k: float(v) for k, v in p.items()
                         if isinstance(v, (int, float)) and k != 'lens_without_breathing'})
            for p in rig.pose.bones if not p.name.startswith('MCH-')}


cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    for parent_kind in ['none', 'rigid', 'scaled', 'created_scaled', 'created_mirrored', 'zero_all', 'zero_y']:
        for action in ['translate_world', 'rotate_world', 'rotate_local', 'scale_world',
                       'scale_local', 'rotate_cursor', 'scale_cursor', 'scale_zero', 'rotate_identity', 'scale_identity']:
            if parent_kind.startswith('zero_') and action in ['rotate_local', 'scale_local']:
                continue
            bpy.ops.object.select_all(action='SELECT')
            bpy.ops.object.delete(use_global=False)
            created = parent_kind.startswith('created_')
            bpy.context.scene.cursor.location = (2.1, -1.3, 0.6) if created else (0, 0, 0)
            bpy.ops.object.build_camera_rig(mode=kind)
            rig = bpy.context.object
            camera = next(o for o in rig.children if o.type == 'CAMERA')
            parent = None
            if parent_kind in ['rigid', 'scaled', 'created_scaled', 'created_mirrored']:
                parent = bpy.data.objects.new('Parent fixture', None)
                bpy.context.scene.collection.objects.link(parent)
                parent.location = (-2, 1.5, 0.8)
                parent.rotation_euler = (-0.15, 0.3, -0.25)
                parent.scale = (-1.3, 0.7, 1.1) if parent_kind == 'created_mirrored' else (1.3, 0.7, 1.1) if parent_kind in ['scaled', 'created_scaled'] else (1, 1, 1)
                bpy.context.view_layer.update()
                rig.parent = parent
                rig.matrix_parent_inverse = parent.matrix_world.inverted() if created else Matrix.Identity(4)
            if not created:
                rig.location = (2.1, -1.3, 0.6)
                rig.rotation_mode = 'XYZ'
                rig.rotation_euler = (0.23, -0.37, 0.41)
                rig.scale = (0, 0, 0) if parent_kind == 'zero_all' else (1.2, 0, 1.1) if parent_kind == 'zero_y' else (1.2, 0.8, 1.1)
            bpy.context.view_layer.update()
            before = C @ rig.matrix_parent_inverse @ rig.matrix_basis @ C.inverted()
            before_object = dict(location=list(rig.location), rotation=list(rig.rotation_euler), scale=list(rig.scale), rotationMode=rig.rotation_mode, parentInverse=flat(C @ rig.matrix_parent_inverse @ C.inverted()))
            world = C @ rig.matrix_world @ C.inverted()
            before_bones = bones(rig)
            cursor = Vector((-1.5, 0.9, 2.25))
            pivot = 'CURSOR' if action.endswith('_cursor') else 'MEDIAN_POINT'
            bpy.context.scene.tool_settings.transform_pivot_point = pivot
            bpy.context.scene.cursor.location = C.inverted() @ cursor
            area = next(a for a in bpy.context.screen.areas if a.type == 'VIEW_3D')
            region = next(r for r in area.regions if r.type == 'WINDOW')
            mode = action.split('_')[0]
            delta = Vector((0.7, -0.2, 0.3))
            axes = world.to_3x3().normalized()
            transform = Matrix.Identity(4)
            with bpy.context.temp_override(area=area, region=region):
                if mode == 'translate':
                    result = bpy.ops.transform.translate(value=C.inverted().to_3x3() @ delta,
                                                        orient_type='GLOBAL')
                elif mode == 'rotate':
                    axis = axes.col[0].normalized() if action == 'rotate_local' else Vector((0, 1, 0))
                    angle = 0 if action == 'rotate_identity' else 0.61
                    transform = Matrix.Rotation(angle, 4, axis)
                    result = bpy.ops.transform.rotate(value=angle,
                            orient_axis='X' if action == 'rotate_local' else 'Z',
                            constraint_axis=(True, False, False) if action == 'rotate_local' else (False, False, True),
                            orient_type='LOCAL' if action == 'rotate_local' else 'GLOBAL')
                else:
                    factors = Vector((0, 0, 0)) if action == 'scale_zero' else Vector((1, 1, 1)) if action == 'scale_identity' else Vector((1.6, 0.7, 1.2))
                    editor_factors = Vector((factors.x, factors.z, factors.y))
                    transform = Matrix.Diagonal((*editor_factors, 1))
                    if action == 'scale_local':
                        transform = axes.to_4x4() @ transform @ axes.inverted().to_4x4()
                    result = bpy.ops.transform.resize(value=factors,
                            orient_type='LOCAL' if action == 'scale_local' else 'GLOBAL')
            assert result == {'FINISHED'}
            bpy.context.view_layer.update()
            graph = bpy.context.evaluated_depsgraph_get()
            cases.append(dict(type={'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind],
                              parentKind=parent_kind, action=action, mode=mode, pivot=pivot,
                              cursor=list(cursor), delta=list(delta), transform=flat(transform),
                              before=flat(before), after=flat(C @ rig.matrix_parent_inverse @ rig.matrix_basis @ C.inverted()),
                              beforeObject=before_object, afterObject=dict(location=list(rig.location), rotation=list(rig.rotation_euler), scale=list(rig.scale), rotationMode=rig.rotation_mode, parentInverse=flat(C @ rig.matrix_parent_inverse @ C.inverted())),
                              parent=flat(C @ parent.matrix_world @ C.inverted()) if parent else flat(Matrix.Identity(4)),
                              beforeBones=before_bones, afterBones=bones(rig),
                              cameraMatrix=flat(C @ camera.evaluated_get(graph).matrix_world),
                              objectMode=bpy.context.mode,
                              selectedBones=[p.name for p in rig.pose.bones if p.select]))

result = dict(blender=bpy.app.version_string, buildHash=bpy.app.build_hash.decode(),
              source='add-camera-rigs@1.9.0',
              sourceSHA256=hashlib.sha256((SOURCE / 'build_rigs.py').read_bytes()).hexdigest(),
              operator='bpy.ops.transform.translate/rotate/resize', cases=cases)
output = ROOT / 'tests/integration/fixtures/add-camera-rigs-object-transforms.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(f'Exported {len(cases)} native Object transform cases')
