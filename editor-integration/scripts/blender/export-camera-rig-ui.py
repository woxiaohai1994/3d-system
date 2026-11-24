# SPDX-License-Identifier: GPL-3.0-or-later
"""Execute the unmodified add-on draw methods and record Blender RNA/layout data."""
import hashlib
import importlib.util
import itertools
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace

import bpy

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
CAMERA_RNA = ROOT / 'vendor/blender-camera-panorama/rna_camera.cc'
camera_type_block = re.search(
    r'static const EnumPropertyItem prop_type_items\[\] = \{(.*?)\n  \};',
    CAMERA_RNA.read_text(), re.S).group(1)
camera_type_items = [dict(value=value, name=name, description=description)
                     for value, name, description in re.findall(
                         r'\{CAM_\w+, "([^"]+)", 0, "([^"]+)", "([^"]*)"\}',
                         camera_type_block)]
assert [item['value'] for item in camera_type_items] == ['PERSP', 'ORTHO', 'PANO']
spec = importlib.util.spec_from_file_location('add_camera_rigs', SOURCE / '__init__.py',
                                            submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = spec.name
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

rig = cam = None


def owner_path(owner):
    root = owner.id_data
    role = ('rig' if root == rig else 'camera' if root == cam else
            'cameraData' if root == cam.data else 'scene' if root == bpy.context.scene else None)
    if role is None:
        raise ValueError('Unmapped RNA owner: ' + str(owner))
    return role, '' if owner == root else owner.path_from_id()


def metadata(owner, name):
    if name.startswith('["'):
        key = name[2:-2]
        if key not in owner:
            return dict(name=key, type='MISSING')
        data = dict(owner.id_properties_ui(key).as_dict())
        data = dict(name=key, type='FLOAT', is_animatable=True, is_readonly=False,
                    is_array=False, **data)
        path = owner.path_from_id() + name
        drivers = owner.id_data.animation_data
        data['driven_indices'] = [f.array_index for f in drivers.drivers
                                  if f.data_path == path] if drivers else []
        data['data_path'] = path
        return data
    prop = (owner if isinstance(owner, bpy.types.Struct) else owner.bl_rna).properties[name]
    data = dict(name=prop.name, description=prop.description, type=prop.type,
                is_animatable=prop.is_animatable, is_readonly=prop.is_readonly,
                is_array=getattr(prop, 'is_array', False))
    if getattr(owner, 'id_data', None) is not None:
        path = owner.path_from_id(name)
        drivers = getattr(owner.id_data, 'animation_data', None)
        data['data_path'] = path
        data['driven_indices'] = [f.array_index for f in drivers.drivers
                                  if f.data_path == path] if drivers else []
    for field in ['hard_min', 'hard_max', 'soft_min', 'soft_max', 'step', 'precision', 'subtype']:
        if hasattr(prop, field):
            data[field] = getattr(prop, field)
    if prop.type == 'ENUM':
        data['items'] = [dict(value=p.identifier, name=p.name, description=p.description)
                         for p in prop.enum_items]
        if cam is not None and owner == cam.data and name == 'type':
            # The reference host is 4.3. Its original Camera RNA has three types.
            # Exporting with a later installed Blender must not add host-only CUSTOM.
            data['items'] = camera_type_items
    return data


class Layout:
    def __init__(self, kind='layout', **options):
        if kind in ('layout', 'column', 'row'):
            options = dict(use_property_split=False, use_property_decorate=True) | options
        object.__setattr__(self, 'data', dict(kind=kind, options=options, children=[]))
        object.__setattr__(self, '_parent', None)
        object.__setattr__(self, '_properties', {})

    def __setattr__(self, key, value):
        self.data['options'][key] = value

    def child(self, kind, **options):
        if kind in ('column', 'row'):
            options = {key: self.data['options'][key]
                       for key in ('use_property_split', 'use_property_decorate')} | options
        child = Layout(kind, **options)
        object.__setattr__(child, '_parent', self)
        object.__setattr__(child, '_properties', self._properties)
        self.data['children'].append(child.data)
        return child

    def enabled(self):
        return (self.data['options'].get('active', True) and
                self.data['options'].get('enabled', True) and
                (self._parent is None or self._parent.enabled()))

    def column(self, **options):
        return self.child('column', **options)

    def row(self, **options):
        return self.child('row', **options)

    def prop(self, owner, name, **options):
        role, path = owner_path(owner)
        self._properties[role, path, name] = self.enabled()
        return self.child('prop', owner=role, path=path, property=name,
                          decorate=self.data['options']['use_property_split'] and
                                   self.data['options']['use_property_decorate'],
                          rna=metadata(owner, name), **options)

    def prop_search(self, owner, name, search_owner, search_property, **options):
        role, path = owner_path(owner)
        return self.child('search', owner=role, path=path, property=name,
                          collection=search_property, rna=metadata(owner, name), **options)

    def operator(self, name, **options):
        namespace, operator = name.split('.')
        rna = getattr(getattr(bpy.ops, namespace), operator).get_rna_type()
        return self.child('operator', operator=name, label=rna.name,
                          description=rna.description, **options)

    def menu(self, name, **options):
        return self.child('menu', menu=name, **options)

    def popover(self, **options):
        return self.child('popover', **options)

    def separator(self, **options):
        return self.child('separator', **options)

    def label(self, **options):
        return self.child('label', **options)

    def prop_decorator(self, owner, name, **options):
        role, path = owner_path(owner)
        return self.child('decorator', owner=role, path=path, property=name,
                          ui_enabled=self._properties.get((role, path, name), False),
                          rna=metadata(owner, name), **options)


def draw(cls, method='draw'):
    layout = Layout()
    getattr(cls, method)(SimpleNamespace(layout=layout), bpy.context)
    return layout.data


trees = []
tree_ids = {}


def intern(tree):
    key = json.dumps(tree, sort_keys=True)
    if key not in tree_ids:
        tree_ids[key] = len(trees)
        trees.append(tree)
    return tree_ids[key]


panels = [value for value in vars(addon.ui_panels).values()
          if isinstance(value, type) and value.__name__.startswith('ADD_CAMERA_RIGS_PT_')]
panel_meta = [dict(id=p.__name__, label=p.bl_label, parent=getattr(p, 'bl_parent_id', None),
                   category=p.bl_category) for p in panels]
variants = {}
widgets = {}
focus_object = bpy.data.objects.new('UI focus fixture', None)
bpy.context.scene.collection.objects.link(focus_object)

for kind in ['dolly', 'crane', '2d']:
    addon.build_rigs.build_camera_rig(bpy.context, kind.upper())
    rig = bpy.context.active_object
    cam = next(o for o in rig.children if o.type == 'CAMERA')
    widgets[kind] = {}
    for p in rig.pose.bones:
        if p.name.startswith('MCH-'):
            continue
        color = p.bone.color if p.color.palette == 'DEFAULT' else p.color
        widgets[kind][p.name] = dict(palette=color.palette,
                                    normal=list(color.custom.normal),
                                    select=list(color.custom.select),
                                    active=list(color.custom.active),
                                    wireWidth=p.custom_shape_wire_width)
    for projection, dolly, dof, focus, sensor, mask in itertools.product(
            ['PERSP', 'ORTHO'], [False, True] if kind != '2d' else [False],
            [False, True], ['manual', 'object', 'rig'], [36, 50], [False, True]):
        cam.data.type = projection
        cam.data.sensor_width = sensor
        cam.data.dof.use_dof = dof
        cam.data.show_passepartout = mask
        cam.data.dof.focus_object = (None if focus == 'manual' else
                                     rig if focus == 'rig' else focus_object)
        if kind != '2d':
            driver = next(f.driver for f in rig.animation_data.drivers
                          if 'lens_without_breathing' in f.data_path)
            driver.expression = addon.operators.get_lens_expr(10 if dolly else None)
        key = ':'.join([kind, projection, str(int(dolly)), str(int(dof)), focus,
                        str(int(sensor == 36)), str(int(mask))])
        variants[key] = [dict(panel=p.__name__, body=intern(draw(p)),
                              **({'header': intern(draw(p, 'draw_header'))}
                                 if hasattr(p, 'draw_header') else {})) for p in panels]
        if kind != '2d':
            variants[key].append(dict(menu='ADD_CAMERA_RIGS_MT_lens_ops',
                                      body=intern(draw(addon.ui_panels.ADD_CAMERA_RIGS_MT_lens_ops))))

theme = bpy.context.preferences.themes[0]
colors = {f'THEME{i + 1:02d}': dict(normal=list(c.normal), select=list(c.select),
                                  active=list(c.active))
          for i, c in enumerate(theme.bone_color_sets)}
colors['DEFAULT'] = dict(normal=list(theme.view_3d.bone_solid),
                         select=list(theme.view_3d.bone_pose),
                         active=list(theme.view_3d.bone_pose_active))
source_files = ['ui_panels.py', 'operators.py', 'build_rigs.py', 'create_widgets.py',
                'composition_guides_menu.py']
result = dict(source=json.loads((ROOT / 'vendor/add-camera-rigs.UPSTREAM.json').read_text()),
              blenderVersion=bpy.app.version_string,
              cameraTypeRNA=dict(blenderVersion='4.3.0',
                                 path=str(CAMERA_RNA.relative_to(ROOT)),
                                 sha256=hashlib.sha256(CAMERA_RNA.read_bytes()).hexdigest(),
                                 items=camera_type_items),
              swapLens=metadata(bpy.ops.add_camera_rigs.swap_lens.get_rna_type(), "camera_lens"),
              poseTransformRNA={name: metadata(bpy.types.PoseBone.bl_rna, name)
                                for name in ['location', 'rotation_euler', 'scale']},
              hashes={name: hashlib.sha256((SOURCE / name).read_bytes()).hexdigest()
                      for name in source_files}, panels=panel_meta, trees=trees,
              variants=variants, widgets=widgets, colors=colors,
              composition=draw(addon.composition_guides_menu.ADD_CAMERA_RIGS_PT_composition_guides))
output = ROOT / 'packages/editor/src/components/scene-camera/rig-source-ui.json'
output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'Exported {len(variants)} source UI states, {len(trees)} unique layout trees to {output}')
