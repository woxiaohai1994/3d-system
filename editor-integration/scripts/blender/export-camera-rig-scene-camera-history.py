# SPDX-License-Identifier: GPL-3.0-or-later
"""Record original scene-camera operators with explicit Blender memfile undo steps.

Run: blender --background --factory-startup --python this_file.py
The source Set Active operator does not declare UNDO, so the host undo snapshots
are pushed explicitly rather than attributed to the add-on operator itself.
"""
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
bpy.context.preferences.edit.use_global_undo = True


def scenario(case):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.timeline_markers.clear()
    bpy.context.scene.frame_end = 250
    names = {}
    for label, mode in [('A', 'DOLLY'), ('B', 'CRANE'), ('C', 'DOLLY')]:
        bpy.ops.object.build_camera_rig(mode=mode)
        rig = bpy.context.active_object
        camera = next(child for child in rig.children if child.type == 'CAMERA')
        names[label] = dict(rig=rig.name, camera=camera.name)

    def select(label):
        for obj in bpy.context.view_layer.objects:
            obj.select_set(False)
        rig = bpy.data.objects[names[label]['rig']]
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig

    states = []

    def record(step):
        bpy.context.view_layer.update()
        camera = bpy.context.scene.camera
        label = next((label for label, item in names.items()
                      if camera and item['camera'] == camera.name), None)
        states.append(dict(
            step=step, frame=bpy.context.scene.frame_current,
            frameEnd=bpy.context.scene.frame_end, sceneCamera=label,
            allCamerasExist=all(item['camera'] in bpy.data.objects
                                for item in names.values())))

    def active(label):
        select(label)
        bpy.ops.add_camera_rigs.set_scene_camera()
        bpy.ops.ed.undo_push(message='Active ' + label)
        record('set-' + label)

    bpy.context.scene.frame_set(48)
    select('A')
    bpy.ops.add_camera_rigs.add_marker_bind()
    bpy.ops.ed.undo_push(message='Marker A initial snapshot')
    record('initial-marker-A')
    if case == 'unrelated-history':
        bpy.context.scene.frame_end = 300
        bpy.ops.ed.undo_push(message='Unrelated duration edit')
        record('duration-edit')
        active('C')
        for action, step in [('undo', 'Undo-C'), ('undo', 'Undo-duration'),
                             ('redo', 'Redo-duration'), ('redo', 'Redo-C')]:
            getattr(bpy.ops.ed, action)()
            record(step)
    else:
        active('B')
        active('C')
        if case == 'seek-and-return':
            bpy.context.scene.frame_set(49)
            record('seek-49')
            bpy.context.scene.frame_set(48)
            record('seek-back-48')
        bpy.ops.ed.undo()
        record('Undo-C')
        bpy.ops.ed.redo()
        record('Redo-C')
    return dict(id=case, states=states)


cases = [scenario(case) for case in
         ['successive-manual', 'unrelated-history', 'seek-and-return']]
files = [SOURCE / 'operators.py', SOURCE / 'build_rigs.py',
         ROOT / 'vendor/blender-scene-camera/scene.cc']
result = dict(
    blender=bpy.app.version_string,
    sourceDeclaresUndo='UNDO' in addon.operators.ADD_CAMERA_RIGS_OT_set_scene_camera
        .__dict__.get('bl_options', set()),
    undoPolicy='Explicit bpy.ops.ed.undo_push snapshots; Set Active does not declare UNDO',
    sources={str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in files}, cases=cases)
target = ROOT / 'tests/integration/fixtures/add-camera-rigs-scene-camera-history.json'
target.write_text(json.dumps(result, indent=2) + '\n')
print('Exported', sum(len(case['states']) for case in cases),
      'scene-camera history states from Blender', bpy.app.version_string)
