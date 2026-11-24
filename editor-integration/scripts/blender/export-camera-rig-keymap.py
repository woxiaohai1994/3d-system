# SPDX-License-Identifier: GPL-2.0-or-later
"""Run Blender's original keymap generators for pose transforms and active tools."""
from pathlib import Path
import hashlib
import json
import re
import runpy

ROOT = Path(__file__).resolve().parents[2]
vendor = ROOT / 'vendor/blender-keymap'
source = vendor / 'blender_default.py'
module = runpy.run_path(str(source))
params = module['Params'](select_mouse='LEFT')
tools = {
    'pose': module['km_pose'](params),
    'select': module['km_3d_view_tool_select'](params, fallback=True),
    **{name: module['km_3d_view_tool_' + name](params) for name in ['move', 'rotate', 'scale']},
}
preferences = (vendor / 'userdef_default.c').read_text()
data = {
    'source': 'Blender v4.3.0 original keymap generators, LEFT selection',
    'hashes': {name: hashlib.sha256((vendor / name).read_bytes()).hexdigest()
               for name in ['blender_default.py', 'userdef_default.c']},
    'dragThreshold': int(re.search(r'\.drag_threshold_mouse\s*=\s*(\d+)', preferences)[1]),
    'releaseConfirm': 'USER_RELEASECONFIRM' in re.search(r'\.flag\s*=\s*\((.*?)\)', preferences, re.S)[1],
    'maps': {name: value[2]['items'] for name, value in tools.items()},
}
(ROOT / 'packages/editor/src/components/scene-camera/rig-keymap-source.json').write_text(json.dumps(data, indent=2) + '\n')
print('Exported original pose and four active-tool keymaps')
