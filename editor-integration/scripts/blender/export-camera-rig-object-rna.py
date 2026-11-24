#!/usr/bin/env python3
"""Freeze the v4.3.0 Object RNA numeric declarations used by camera rigs."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "vendor/blender-rig-object-rna"
OUTPUT = ROOT / "packages/editor/src/components/scene-camera/rig-object-rna-source.json"


def generate():
    manifest = json.loads((VENDOR / "UPSTREAM.json").read_text())
    for name, entry in manifest["files"].items():
        digest = hashlib.sha256((VENDOR / name).read_bytes()).hexdigest()
        if digest != entry["sha256"]:
            raise ValueError(f"Source SHA mismatch: {name}")
    source = (VENDOR / "rna_object.cc").read_text()
    definitions = (VENDOR / "rna_define.cc").read_text()
    types = (VENDOR / "RNA_types.hh").read_text()
    precision = int(re.search(r"#define RNA_TRANSLATION_PREC_DEFAULT (\d+)", types)[1])
    assert "fprop->hardmin = (subtype == PROP_UNSIGNED) ? 0.0f : -FLT_MAX;" in definitions
    assert "fprop->hardmax = FLT_MAX;" in definitions
    maximum = struct.unpack("<f", struct.pack("<I", 0x7F7FFFFF))[0]
    properties = {}
    for name in ("location", "rotation_euler", "scale"):
        block = re.search(
            rf'  prop = RNA_def_property\(srna, "{name}", PROP_FLOAT, PROP_(\w+)\);'
            r'(?P<body>.*?)(?=\n  prop = RNA_def_property\(|\Z)',
            source,
            re.S,
        )
        assert block is not None
        assert "RNA_def_property_range(" not in block["body"]
        ui = re.search(
            r"RNA_def_property_ui_range\(prop, -FLT_MAX, FLT_MAX, (\d+), "
            r"(RNA_TRANSLATION_PREC_DEFAULT|\d+)\);",
            block["body"],
        )
        assert ui is not None
        properties[name] = {
            "subtype": block[1],
            "hard_min": -maximum,
            "hard_max": maximum,
            "soft_min": -maximum,
            "soft_max": maximum,
            "step": int(ui[1]),
            "precision": precision if ui[2] == "RNA_TRANSLATION_PREC_DEFAULT" else int(ui[2]),
            "source_line": source[:block.start()].count("\n") + 1,
        }
    return {
        "source": {
            "ref": manifest["ref"],
            "method": "Source declaration extraction; hard bounds use RNA_def_property PROP_FLOAT defaults, UI bounds use the explicit Object declarations.",
            "files": manifest["files"],
        },
        "objectTransformRNA": properties,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = json.dumps(generate(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if json.loads(OUTPUT.read_text()) != json.loads(result):
            raise SystemExit("Object RNA fixture is stale")
        print("Object RNA: 3 declarations and source SHA verified")
    else:
        OUTPUT.write_text(result)
        print(OUTPUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
