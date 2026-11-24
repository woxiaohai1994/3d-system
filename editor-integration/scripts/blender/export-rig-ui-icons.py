# SPDX-License-Identifier: GPL-2.0-or-later
"""Bundle the upstream SVGs referenced by the add-on's executed UI layouts."""
import base64
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / 'vendor/blender-rig-ui-icons'
source = json.loads((VENDOR / 'UPSTREAM.json').read_text())
icons = {}
for name, entry in source['files'].items():
    raw = (VENDOR / Path(entry['path']).name).read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise ValueError(f'Upstream icon changed: {name}')
    icons[name] = 'data:image/svg+xml;base64,' + base64.b64encode(raw).decode()
output = ROOT / 'packages/editor/src/components/scene-camera/rig-ui-icons-source.json'
output.write_text(json.dumps(dict(source=source, icons=icons), separators=(',', ':')) + '\n')
