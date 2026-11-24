# SPDX-License-Identifier: GPL-3.0-or-later
"""Record pose color overrides and the underlying bone color after source operators."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location(
    'add_camera_rigs', SOURCE / '__init__.py',
    submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = spec.name

sequence = []
for mode in ['DOLLY', 'CRANE']:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.object.build_camera_rig(mode=mode)
    rig = bpy.context.object

    def capture(step, operation=None):
        pose = rig.pose.bones['Aim']
        bone = pose.bone
        # v4.3 UnifiedBonePtr.effective_bonecolor falls back to Bone for DEFAULT.
        effective = bone.color if pose.color.palette == 'DEFAULT' else pose.color
        sequence.append(dict(
            rig=mode.lower(), step=step, operation=operation,
            posePalette=pose.color.palette, bonePalette=bone.color.palette,
            effectivePalette=effective.palette))

    capture('initial')
    for step, operation in [
        ('enable-1', 'set_dolly_zoom'), ('remove-1', 'remove_dolly_zoom'),
        ('enable-2', 'set_dolly_zoom'), ('remove-2', 'remove_dolly_zoom'),
        ('remove-3', 'remove_dolly_zoom'),
    ]:
        getattr(bpy.ops.add_camera_rigs, operation)()
        bpy.context.view_layer.update()
        capture(step, operation)

files = [SOURCE / 'operators.py', SOURCE / 'build_rigs.py',
         ROOT / 'vendor/blender-rig-wire/overlay_armature.cc']
result = dict(
    blender=bpy.app.version_string, drawingReference='Blender v4.3.0',
    sources={str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in files}, sequence=sequence)
(ROOT / 'tests/integration/fixtures/add-camera-rigs-palette-sequence.json').write_text(
    json.dumps(result, indent=2) + '\n')
print('Exported', len(sequence), 'source palette sequence states')
