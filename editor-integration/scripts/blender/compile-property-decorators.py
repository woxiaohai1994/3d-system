# SPDX-License-Identifier: GPL-2.0-or-later
"""Execute Blender's unchanged decorator callbacks against a recording UI adapter."""
from pathlib import Path
import base64
import hashlib
import json
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/blender-property-decorators'
manifest = json.loads((SOURCE / 'UPSTREAM.json').read_text())
for name, entry in manifest['files'].items():
    assert hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() == entry['sha256'], name


def function(text, name):
    match = re.search(r'void ' + name + r'\([^{}]+\)\s*\{', text)
    end, depth = match.end(), 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[match.start():end]


anim = (SOURCE / 'interface_anim.cc').read_text()
original = '\n\n'.join(function(anim, name) for name in [
    'ui_but_anim_decorate_update_from_flag', 'ui_but_anim_decorate_cb'])
names = ['ANIMATED', 'ANIMATED_KEY', 'DRIVEN', 'OVERRIDDEN', 'DISABLED', 'INACTIVE']
header = (SOURCE / 'UI_interface_c.hh').read_text()
flags = {}
for name in names:
    match = re.search(r'UI_BUT_' + name + r' = 1u? << (\d+)u?', header)
    flags[name] = 1 << int(match[1])
icons = ['decorate', 'decorate_driver', 'decorate_keyframe', 'decorate_animate', 'decorate_override']
harness = '''#include <cstdint>
#include <cstdio>
#include <iostream>
#include <utility>
#include <string>
struct PointerRNA { void *data = nullptr; void *type = nullptr; bool all = false; };
struct uiBut { uint32_t flag = 0; int rnaindex = 0; void *active = nullptr; };
struct uiButDecorator : uiBut {
  PointerRNA decorated_rnapoin; void *decorated_rnaprop = nullptr;
  int icon = 0; uiBut *attached = nullptr;
};
struct wmWindowManager { int op_undo_depth = 0; };
struct bContext { wmWindowManager wm; };
struct wmOperatorType { std::string name; };
static int action = 0; static bool all = false;
static wmWindowManager *CTX_wm_manager(bContext *c) { return &c->wm; }
static uiBut *ui_but_anim_decorate_find_attached_button(uiButDecorator *b) { return b->attached; }
static const char *RNA_struct_identifier(void *) { return "fixture"; }
static const char *RNA_property_identifier(void *) { return "fixture"; }
static wmOperatorType *WM_operatortype_find(const char *name, bool) {
  static wmOperatorType op; op.name = name; return &op;
}
static void WM_operator_properties_create_ptr(PointerRNA *, wmOperatorType *) {}
static void RNA_boolean_set(PointerRNA *p, const char *, bool value) { p->all = value; }
static void WM_operator_name_call_ptr(bContext *, wmOperatorType *op, int, PointerRNA *p, void *) {
  action = op->name == "ANIM_OT_keyframe_insert_button" ? 1 : 2; all = p->all;
}
static void WM_operator_properties_free(PointerRNA *) {}
constexpr int WM_OP_INVOKE_DEFAULT = 0;
'''
harness += '\n'.join(f'constexpr uint32_t UI_BUT_{name} = {value}u;' for name, value in flags.items())
harness += '\n' + '\n'.join(f'constexpr int ICON_{name.upper()} = {i};' for i, name in enumerate(icons))
harness += '\n' + original + '\nint main() {\n'
harness += 'uint32_t bits[] = {' + ','.join(f'{value}u' for value in flags.values()) + '};\n'
harness += '''
  for (int mask = 0; mask < 64; mask++) {
    for (int index = -1; index <= 1; index++) {
      bContext ctx; uiBut property; uiButDecorator decorator;
      for (int bit = 0; bit < 6; bit++) if (mask & (1 << bit)) property.flag |= bits[bit];
      property.rnaindex = index; property.active = &property;
      decorator.active = &decorator; decorator.attached = &property;
      decorator.decorated_rnapoin.data = &property; decorator.decorated_rnaprop = &property;
      action = 0; all = false;
      ui_but_anim_decorate_update_from_flag(&decorator);
      ui_but_anim_decorate_cb(&ctx, &decorator, nullptr);
      if (ctx.wm.op_undo_depth != 0 || property.active != &property || decorator.active != &decorator) return 1;
      std::cout << mask << " " << index << " " << decorator.icon << " "
                << bool(decorator.flag & (UI_BUT_DISABLED | UI_BUT_INACTIVE)) << " "
                << action << " " << all << "\\n";
    }
  }
}
'''
with tempfile.TemporaryDirectory(prefix='blender-decorator-') as directory:
    cpp, exe = Path(directory) / 'decorator.cc', Path(directory) / 'decorator'
    cpp.write_text(harness)
    subprocess.run(['clang++', '-std=c++17', str(cpp), '-o', str(exe)], check=True)
    rows = [list(map(int, line.split())) for line in subprocess.check_output([str(exe)], text=True).splitlines()]
states = []
for mask in range(64):
    variants = [row for row in rows if row[0] == mask]
    states.append(dict(icon=icons[variants[0][2]], disabled=bool(variants[0][3]),
                       action=['none', 'insert', 'delete'][variants[0][4]],
                       all=[bool(row[5]) for row in variants]))
result = dict(flags=names, states=states,
              hashes={name: entry['sha256'] for name, entry in manifest['files'].items()},
              icons={name: 'data:image/svg+xml;base64,' + base64.b64encode((SOURCE / (name + '.svg')).read_bytes()).decode()
                     for name in icons})
out = ROOT / 'packages/editor/src/components/scene-camera/rig-property-decorator-source.json'
out.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'Executed original decorator callbacks for {len(rows)} flag/index cases')
