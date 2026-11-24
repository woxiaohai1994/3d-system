#!/usr/bin/env python3
"""Read-only local source audit for INT-3D-BASE-001.

Does not fetch, install, checkout, run repository scripts, modify Git configuration,
or evaluate source code. The only write is a NEW report file explicitly passed
as --out. No secrets/environment variables or remote URL credentials are logged.
This verifies source identity, not runtime or feature compatibility.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env['GIT_OPTIONAL_LOCKS'] = '0'
    return subprocess.run(['git', '-C', str(repo), *args], capture_output=True,
                          text=True, encoding='utf-8', errors='replace',
                          timeout=30, env=env, check=False)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def audit_repo(path: Path, spec: dict[str, Any], *, allow_descendant: bool = False) -> dict[str, Any]:
    repo = path.resolve()
    result: dict[str, Any] = {'repository': spec['repository'], 'path': str(repo),
        'expected_commit': spec['commit'], 'status': 'FAIL', 'errors': [],
        'warnings': [], 'files': [], 'runtime_verified': False}
    if not repo.is_dir():
        result['errors'].append('Repository directory does not exist.')
        return result
    try:
        root = git(repo, 'rev-parse', '--show-toplevel')
        if root.returncode != 0 or Path(root.stdout.strip()).resolve() != repo:
            result['errors'].append('Path is not the repository root.')
            return result
        status = git(repo, 'status', '--porcelain=v1', '--untracked-files=normal')
        if status.returncode != 0:
            result['errors'].append('Cannot read git status.')
            return result
        result['worktree_status'] = status.stdout.splitlines()
        if status.stdout.strip():
            result['errors'].append('Worktree is dirty. Do not stash/reset/overwrite user changes.')
        head = git(repo, 'rev-parse', 'HEAD')
        if head.returncode != 0:
            result['errors'].append('Cannot resolve HEAD.')
            return result
        result['actual_commit'] = head.stdout.strip()
        exists = git(repo, 'cat-file', '-e', spec['commit'] + '^{commit}')
        if exists.returncode != 0:
            result['errors'].append('Pinned commit is unavailable locally. No automatic fetch was attempted.')
        elif result['actual_commit'] == spec['commit']:
            result['identity'] = 'EXACT_PIN'
        elif allow_descendant and git(repo, 'merge-base', '--is-ancestor', spec['commit'], 'HEAD').returncode == 0:
            result['identity'] = 'PINNED_BASE_ANCESTOR'
            result['warnings'].append('Base has integration commits; preservation must be checked with regression tests.')
        else:
            result['errors'].append('HEAD does not match the required pin/allowed base ancestry.')
        for relative in spec.get('paths', []):
            candidate = (repo / relative).resolve()
            if not candidate.is_relative_to(repo):
                result['errors'].append('Unsafe path in manifest: ' + relative)
                continue
            record: dict[str, Any] = {'path': relative, 'exists': candidate.is_file()}
            if candidate.is_file():
                record.update(size_bytes=candidate.stat().st_size, sha256=sha256_file(candidate))
            else:
                result['errors'].append('Required file missing: ' + relative)
            result['files'].append(record)
        for name in ('bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml'):
            file = repo / name
            if file.is_file():
                result.setdefault('lockfiles', []).append({'path': name, 'sha256': sha256_file(file)})
        package = repo / 'package.json'
        if package.is_file() and package.resolve().is_relative_to(repo):
            if package.stat().st_size > 2 * 1024 * 1024:
                result['errors'].append('Root package.json unexpectedly exceeds 2 MiB.')
            else:
                data = json.loads(package.read_text(encoding='utf-8'))
                result['package_manager'] = data.get('packageManager')
                result['node_engine'] = data.get('engines', {}).get('node')
                # Names only: do not run or log arbitrary script bodies.
                result['available_script_names'] = sorted(data.get('scripts', {}).keys())
        result['status'] = 'PASS_SOURCE_AUDIT' if not result['errors'] else 'FAIL'
        return result
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        result['errors'].append(f'{type(exc).__name__}: {exc}')
        return result


def write_new_report(path: Path, report: dict[str, Any]) -> None:
    if not path.parent.is_dir():
        raise ValueError('Report parent directory does not exist; create it explicitly first.')
    # Atomic exclusive creation prevents overwriting an existing evidence file.
    with path.open('x', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, type=Path)
    parser.add_argument('--aedifex', required=True, type=Path)
    parser.add_argument('--openplan', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--allow-base-descendant', action='store_true')
    args = parser.parse_args(argv)
    if args.out.exists():
        parser.error('--out already exists. Evidence is never overwritten.')
    manifest_path = Path(__file__).resolve().parents[1] / 'manifests' / 'source-lock.json'
    try:
        lock = json.loads(manifest_path.read_text(encoding='utf-8'))
        specs = lock['projects']
        rows = [audit_repo(args.base, specs['pascal'], allow_descendant=args.allow_base_descendant),
                audit_repo(args.aedifex, specs['aedifex']),
                audit_repo(args.openplan, specs['openplan'])]
        report = {'document_id': lock['document_id'], 'manifest_sha256': sha256_file(manifest_path),
                  'audit_kind': 'READ_ONLY_LOCAL_SOURCE_IDENTITY', 'runtime_verified': False,
                  'results': rows}
        write_new_report(args.out, report)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f'Audit failed: {exc}', file=sys.stderr)
        return 2
    for row in rows:
        print(f"{row['repository']}: {row['status']}")
        for error in row['errors']:
            print('  - ' + error)
    print('No repositories were changed. This is NOT a runtime/integration test.')
    return 0 if all(not row['errors'] for row in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
