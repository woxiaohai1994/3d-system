# SPDX-License-Identifier: GPL-3.0-or-later
"""Compile the vendored operator bodies, leaving bpy/mathutils to a host adapter.

Unsupported Python syntax fails the build rather than silently changing behavior.
"""
import ast
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / 'vendor/add-camera-rigs/operators.py'
source = path.read_text()
tree = ast.parse(source)
functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}


def expr(n):
    if isinstance(n, ast.Constant):
        return json.dumps(n.value)
    if isinstance(n, ast.Name):
        return n.id
    if isinstance(n, (ast.List, ast.Tuple, ast.Set)):
        return '[' + ', '.join(map(expr, n.elts)) + ']'
    if isinstance(n, ast.Attribute):
        return f'h.get({expr(n.value)}, {json.dumps(n.attr)})'
    if isinstance(n, ast.Subscript):
        return f'h.get({expr(n.value)}, {expr(n.slice)})'
    if isinstance(n, ast.Call):
        args = [expr(a) for a in n.args]
        if n.keywords:
            if isinstance(n.func, ast.Name) and n.func.id in functions:
                params = functions[n.func.id].args.args
                keywords = {k.arg: k.value for k in n.keywords}
                args.extend(expr(keywords[p.arg]) if p.arg in keywords else 'undefined' for p in params[len(args):])
            else:
                args.append('{' + ', '.join(json.dumps(k.arg) + ': ' + expr(k.value) for k in n.keywords) + '}')
        return expr(n.func) + '(' + ', '.join(args) + ')'
    if isinstance(n, ast.BinOp):
        return f'h.binary({json.dumps(type(n.op).__name__)}, {expr(n.left)}, {expr(n.right)})'
    if isinstance(n, ast.BoolOp):
        return '(' + (' && ' if isinstance(n.op, ast.And) else ' || ').join(map(expr, n.values)) + ')'
    if isinstance(n, ast.UnaryOp) and isinstance(n.op, ast.Not):
        return f'!({expr(n.operand)})'
    if isinstance(n, ast.IfExp):
        return f'({expr(n.test)} ? {expr(n.body)} : {expr(n.orelse)})'
    if isinstance(n, ast.Compare):
        terms = []
        left = n.left
        for op, right in zip(n.ops, n.comparators):
            terms.append(f'h.compare({json.dumps(type(op).__name__)}, {expr(left)}, {expr(right)})')
            left = right
        return '(' + ' && '.join(terms) + ')'
    if isinstance(n, ast.GeneratorExp):
        body = f'values.push({expr(n.elt)});'
        for g in reversed(n.generators):
            for condition in reversed(g.ifs):
                body = f'if ({expr(condition)}) {{ {body} }}'
            body = f'for (const {expr(g.target)} of {expr(g.iter)}) {{ {body} }}'
        return '(() => { const values = []; ' + body + ' return values; })()'
    raise TypeError(ast.dump(n))


def assign(target, value):
    if isinstance(target, ast.Name):
        return f'{target.id} = {value};'
    if isinstance(target, ast.Tuple):
        return f'{expr(target)} = {value};'
    if isinstance(target, ast.Attribute):
        return f'h.set({expr(target.value)}, {json.dumps(target.attr)}, {value});'
    if isinstance(target, ast.Subscript):
        return f'h.set({expr(target.value)}, {expr(target.slice)}, {value});'
    raise TypeError(ast.dump(target))


def block(nodes):
    return '\n'.join(stmt(n) for n in nodes)


def stmt(n):
    if isinstance(n, ast.Assign):
        assert len(n.targets) == 1
        return assign(n.targets[0], expr(n.value))
    if isinstance(n, ast.AugAssign):
        return assign(n.target, f'h.inplace({json.dumps(type(n.op).__name__)}, {expr(n.target)}, {expr(n.value)})')
    if isinstance(n, ast.Return):
        return f'return {expr(n.value)};'
    if isinstance(n, ast.Expr):
        return '' if isinstance(n.value, ast.Constant) else expr(n.value) + ';'
    if isinstance(n, ast.If):
        return f'if ({expr(n.test)}) {{\n{block(n.body)}\n}}' + (f' else {{\n{block(n.orelse)}\n}}' if n.orelse else '')
    if isinstance(n, ast.For):
        assert not n.orelse
        return f'for ({expr(n.target)} of {expr(n.iter)}) {{\n{block(n.body)}\n}}'
    if isinstance(n, ast.Break):
        return 'break;'
    raise TypeError(ast.dump(n))


def function(n, name):
    args = [a.arg for a in n.args.args]
    defaults = [None] * (len(args) - len(n.args.defaults)) + n.args.defaults
    params = ', '.join(a + ': any' + (' = ' + expr(d) if d is not None else '') for a, d in zip(args, defaults))
    names = sorted({v.id for v in ast.walk(n) if isinstance(v, ast.Name) and isinstance(v.ctx, ast.Store)} - set(args))
    declarations = 'let ' + ', '.join(names) + ';\n' if names else ''
    return f'function {name}({params}) {{\n{declarations}{block(n.body)}\n}}'


out = [
    '// SPDX-License-Identifier: GPL-3.0-or-later',
    '// @ts-nocheck',
    '// Generated directly from operators.py. Do not edit; run scripts/blender/compile-camera-rig-operators.py.',
    f'export const sourceOperatorHash = {json.dumps(hashlib.sha256(source.encode()).hexdigest())}',
    'export function sourceRigOperators(h: any) {',
    'const { mathutils, next, str, hasattr } = h;',
]
operators = []
for item in tree.body:
    if isinstance(item, ast.FunctionDef) and item.name not in ('register', 'unregister'):
        out.append(function(item, item.name))
    elif isinstance(item, ast.ClassDef):
        idname = next(n.value.value for n in item.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'bl_idname')
        methods = []
        for method in item.body:
            if isinstance(method, ast.FunctionDef) and method.name in ('poll', 'execute'):
                name = item.name + '_' + method.name
                out.append(function(method, name))
                methods.append(method.name + ': ' + name)
        operators.append(json.dumps(idname) + ': {' + ', '.join(methods) + '}')
out.append('return {get_lens_expr, operators: {' + ',\n'.join(operators) + '}};\n}')
(ROOT / 'packages/viewer/src/lib/add-camera-rigs-operators-source.ts').write_text('\n'.join(out) + '\n')
print('Compiled', len(operators), 'unmodified upstream operators')

swap = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ADD_CAMERA_RIGS_OT_swap_lens')
ui = [
    '// SPDX-License-Identifier: GPL-3.0-or-later',
    '// @ts-nocheck',
    '// Generated directly from operators.py by compile-camera-rig-operators.py.',
    f'export const sourceSwapLensHash = {json.dumps(hashlib.sha256(source.encode()).hexdigest())}',
    'export function sourceSwapLensUI(h: any) {',
    'const get_rig_and_cam = h.get_rig_and_cam;',
]
for method in swap.body:
    if isinstance(method, ast.FunctionDef) and method.name in ('invoke', 'draw'):
        ui.append(function(method, method.name))
ui.append('return {invoke, draw};\n}')
ui_output = ROOT / 'packages/editor/src/components/scene-camera/rig-swap-lens-source.ts'
ui_output.write_text('\n'.join(ui) + '\n')
subprocess.run([str(ROOT / 'node_modules/.bin/biome'), 'format', '--write', str(ui_output)], check=True)
