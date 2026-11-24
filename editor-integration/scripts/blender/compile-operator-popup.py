# SPDX-License-Identifier: GPL-2.0-or-later
"""Translate the unchanged redo popup callbacks with host history dependencies."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / 'vendor/blender-operator-popup/wm_operators.cc'
source = path.read_text()
digest = hashlib.sha256(path.read_bytes()).hexdigest()
manifest = json.loads((path.parent / 'UPSTREAM.json').read_text())
assert digest == manifest['files'][path.name]['sha256']


def extract(name):
    match = re.search(r'static void ' + name + r'\([^{}]+\)\s*\{', source)
    end, depth = match.end(), 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[match.start():end]


functions = []
for name in ['wm_block_redo_cb', 'wm_block_redo_cancel_cb']:
    body = extract(name)
    body = re.sub(r'static void ' + name + r'\([^{}]+\)',
                  'function ' + name + '(C: unknown, arg_op: unknown)', body)
    body = body.replace('wmOperator *op = static_cast<wmOperator *>(arg_op);', 'const op = arg_op;')
    body = body.replace(' == ', ' === ').replace(' != ', ' !== ')
    functions.append(body)

assert 'int width = 15 * UI_UNIT_X;' in source
assert 'return wm_operator_props_popup_ex(C, op, false, true);' in source
assert 'UI_BLOCK_NUMSELECT | UI_BLOCK_KEEP_OPEN | UI_BLOCK_MOVEMOUSE_QUIT' in source
output = ROOT / 'packages/editor/src/components/scene-camera/rig-operator-popup-source.ts'
output.write_text('''// SPDX-License-Identifier: GPL-2.0-or-later
// Generated from wm_operators.cc by compile-operator-popup.py; do not edit.
export type PopupHistoryHost = {
  WM_operator_last_redo: (context: unknown) => unknown
  ED_undo_operator_repeat: (context: unknown, operator: unknown) => void
  ED_undo_push_op: (context: unknown, operator: unknown) => void
  wm_operator_register: (context: unknown, operator: unknown) => void
  WM_operator_repeat: (context: unknown, operator: unknown) => void
  WM_operator_free: (operator: unknown) => void
}
''' + f'export const sourcePopupHash = {json.dumps(digest)}\n' + '''
export const sourcePopupWidthUnits = 15
export const sourcePopupExecuteOnOpen = false
export function sourcePopupCallbacks(h: PopupHistoryHost) {
const {WM_operator_last_redo, ED_undo_operator_repeat, ED_undo_push_op,
  wm_operator_register, WM_operator_repeat, WM_operator_free} = h;
''' + '\n'.join(functions) + '''
return {update: wm_block_redo_cb, close: wm_block_redo_cancel_cb};
}
''')
print('Translated original Blender redo popup callbacks')
subprocess.run([str(ROOT / 'node_modules/.bin/biome'), 'format', '--write', str(output)], check=True)
