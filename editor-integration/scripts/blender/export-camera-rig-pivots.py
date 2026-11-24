# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise original pose rotation and scale about the 3D cursor in Blender."""
import bpy, importlib.util, json, math, sys
from pathlib import Path
from mathutils import Matrix
ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', source / '__init__.py', submodule_search_locations=[str(source)])
addon = importlib.util.module_from_spec(spec); sys.modules[spec.name] = addon
spec.loader.exec_module(addon); addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
C = Matrix.Rotation(-math.pi / 2, 4, 'X')
flat = lambda m: [m[r][c] for c in range(4) for r in range(4)]
def visible_control(p):
 return p.custom_shape or p.name in ['Crane_Height', 'Crane_Arm']
def state(rig):
 return {p.name: dict(location=list(p.location), rotation=list(p.rotation_euler), scale=list(p.scale), properties={k:p[k] for k in p.keys() if isinstance(p[k],(float,int))}) for p in rig.pose.bones if visible_control(p)}
cases = []
for kind in ['DOLLY','CRANE','2D']:
 if bpy.context.object and bpy.context.object.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
 bpy.ops.object.select_all(action='DESELECT'); addon.build_rigs.build_camera_rig(bpy.context,kind)
 rig = bpy.context.object
 if rig.mode != 'POSE': bpy.ops.object.mode_set(mode='POSE')
 for name in [p.name for p in rig.pose.bones if visible_control(p)]:
  for variant in ['rest','parent-shear','mirrored']:
   for mode in ['rotate','scale']:
    for axis in range(3):
     for p in rig.pose.bones:
      p.matrix_basis = Matrix.Identity(4); p.select = p.name == name
     rig.matrix_world = Matrix.Identity(4)
     p = rig.pose.bones[name]; p.location = (.2,.3,-.4); p.rotation_euler = (.3,-.4,.6)
     if variant != 'rest':
      rig.rotation_euler = (.2,.4,-.3); rig.scale = (2,.7,1.3)
      if name != 'Root':
       rig.pose.bones['Root'].rotation_euler = (.4,-.2,.7)
       rig.pose.bones['Root'].scale = (1.5,.6,2)
      if variant == 'mirrored': rig.scale.x *= -1
     rig.data.bones.active = rig.data.bones[name]; bpy.context.view_layer.update()
     before = state(rig); world = C @ rig.matrix_world @ C.inverted()
     # Use the other end's actual pose head, as Cursor to Selected does.
     other = rig.pose.bones['Camera' if name == 'Aim' else 'Aim']
     bpy.context.scene.cursor.location = rig.matrix_world @ other.head
     pivot = list(C @ bpy.context.scene.cursor.location)
     bpy.context.scene.tool_settings.transform_pivot_point = 'CURSOR'
     axis_b = [0,2,1][axis]; axes = [False]*3; axes[axis_b] = True
     value = .45
     area=next(a for a in bpy.context.screen.areas if a.type == 'VIEW_3D')
     region=next(r for r in area.regions if r.type == 'WINDOW')
     with bpy.context.temp_override(area=area, region=region):
      if mode == 'rotate':
       bpy.ops.transform.rotate(value=value * (-1 if axis == 2 else 1), orient_axis='XYZ'[axis_b], orient_type='GLOBAL', constraint_axis=axes)
      else:
       value = 1.4; factors = [1]*3; factors[axis_b] = value
       bpy.ops.transform.resize(value=factors, orient_type='GLOBAL', constraint_axis=axes)
     bpy.context.view_layer.update()
     cases.append(dict(type={'DOLLY':'dolly','CRANE':'crane','2D':'2d'}[kind],bone=name,variant=variant,mode=mode,axis=axis,value=value,placement=flat(world),pivot=pivot,before=before,location=list(p.location)))
prop=bpy.context.scene.tool_settings.bl_rna.properties['transform_pivot_point']
ui=dict(label=prop.name,description=prop.description,items=[dict(value=i.identifier,label=i.name,description=i.description) for i in prop.enum_items])
(ROOT/'tests/integration/fixtures/add-camera-rigs-pivots.json').write_text(json.dumps(dict(blender=bpy.app.version_string,cases=cases),separators=(',',':')))
(ROOT/'packages/editor/src/components/scene-camera/rig-pivot-ui-source.json').write_text(json.dumps(ui,indent=2)+'\n')
print('Exported',len(cases),'native cursor-pivot transforms')
