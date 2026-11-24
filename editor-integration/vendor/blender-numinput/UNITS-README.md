The advanced units bridge compiles the complete raw Blender v4.3.0 `unit.cc` body. Only its include block is replaced for the isolated translation unit. `BKE_scene_unit_scale` is extracted unchanged from the complete raw `scene.cc`; `UnitSettings` and its enum values are extracted unchanged from `DNA_scene_types.h`, and public unit declarations are taken from `BKE_unit.hh`.

String copy, case-insensitive search and printf helpers are extracted unchanged from raw `string.c`. UTF8 decode/validation, character finding and width functions are extracted unchanged from raw `string_utf8.cc`; they use the complete original `extern/wcwidth/wcwidth.c` tables. The complete `string_cursor_utf8.c` function body is compiled unchanged. This reproduces Blender's Unicode behavior, including its historical width table and delimiter rules; it does not claim to implement a newer Unicode grapheme standard.

`advanced-sources/UPSTREAM.json` records fixed-tag raw URLs and saved-byte SHA-256 values. The full files were downloaded without whitespace normalization. Hashes identify those saved bytes, not an independently verified Git blob. The existing default oracle and its event/formatter fixture tables are separate and unchanged.

The compiler uses the original Apple platform flags `-funsigned-char`, `-fno-strict-aliasing` and `-ffp-contract=off`. Unsigned `char` is essential for `USER_UNIT_ADAPTIVE=255` and original UTF8 character decoding. Compatibility macros and C/JS buffer exports are isolated in the adapter. WASI libc's unused file and clock syscall paths return error codes through C wrappers; the resulting module has no host imports and initializes synchronously. Native comparison uses the host libc, while WASM uses the WASI SDK libc.

The public TypeScript helper supports the camera rig's exact unit IDs `NONE=0`, `LENGTH=1`, `ROTATION=5`; scene systems `NONE=0`, `METRIC=1`, `IMPERIAL=2`; and rotation preferences `degrees=0`, `radians=2`. The full source collections remain compiled. The scene default is NONE, scale_length 1, degrees and adaptive display units. All scene fields are assigned into the original C struct, so scale_length is stored as float32.

`sourceNumInputPreprocess` returns the original unit replacement expression, `hasUnit`, `unitScale` and an informational `multiplier`. After Python evaluation, callers must preserve the source order: explicit units use the evaluated value directly; otherwise call `sourceNumInputPreferredValue(value,type,units)` and then divide by `unitScale`. Multiplying by the combined multiplier can round differently. There is no JavaScript suffix parser. With NONE length units, a recognized length suffix remains unconverted and Python reports invalid syntax, as in the original code.

The bridge text buffer is 4096 bytes. Original numeric insertion rejects content plus its null terminator when their combined size is 64 or greater, so it accepts at most 62 UTF8 content bytes. Explicit-unit conversion retains the original 256-byte buffer; formatted edit text retains the original 64-byte buffer. `sourceNumInputUnitFormat` calls original `BKE_unit_value_as_string_adaptive`, including dummy-unit trailing spaces, split output, negative precision and padding. It always uses adaptive degree formatting for rotation, as that source API does.

Rebuild and verify:

```sh
python3 vendor/blender-numinput/units_build.py
python3 vendor/blender-numinput/generate_unit_fixtures.py
python3 vendor/blender-numinput/units_build.py --check
python3 vendor/blender-numinput/generate_unit_fixtures.py --check
```

`units_build.prepare(out)` returns the generated native translation units, include directory, exact compiler flags, source hashes and shared `unit-native-boundaries.hh`. `build_native(out,target,extra_sources,extra_flags)` can link the advanced NumInput event oracle to the same real unit and Unicode implementation.

`unit-fixtures.json` is frozen from native C++ output. The generator runs real CPython with math globals and builtins, accumulating tuple results and mapping nonfinite numeric results to zero following `PyC_RunString_AsNumber`. Its Python version is recorded. Python evaluation itself is supplied by the caller in production, independently of this units module.
