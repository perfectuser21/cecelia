#!/usr/bin/env python3
"""只对 manifest 中的精确现场基线应用补丁；调用者先停轮询并确认无活跃任务。"""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import uuid

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def apply(artifact, target, group, install=False):
    artifact, target = pathlib.Path(artifact).resolve(), pathlib.Path(target).resolve()
    config = json.loads((artifact / 'manifest.json').read_text())['groups'][group]
    patch = artifact / config['patch']
    if digest(patch) != config['patch_sha256']:
        raise ValueError('patch hash mismatch')
    for name, hashes in config['files'].items():
        if digest(target / name) != hashes['before']:
            raise ValueError('baseline hash mismatch: ' + name)
    for name, expected in config['guards'].items():
        if digest(artifact.parent / name) != expected:
            raise ValueError('guard hash mismatch: ' + name)
        if (target / name).exists() and digest(target / name) != expected:
            raise ValueError('baseline guard already differs: ' + name)
    expected = {name: hashes['after'] for name, hashes in config['files'].items()} | config['guards']
    with tempfile.TemporaryDirectory(prefix='lease-stage-', dir=target.parent) as temporary:
        stage = pathlib.Path(temporary)
        for name in config['files']:
            shutil.copy2(target / name, stage / name)
        subprocess.run(['patch', '--batch', '-p1', '-i', str(patch)], cwd=stage, check=True, capture_output=True)
        for name in config['guards']:
            shutil.copy2(artifact.parent / name, stage / name)
        for name, sha in expected.items():
            if digest(stage / name) != sha:
                raise ValueError('output hash mismatch: ' + name)
        result = {'verified':True, 'group':group, 'installed':False, 'hashes':expected}
        if not install:
            return result
        # 再核一次现场；任何漂移都在首次替换之前拒绝。
        for name, hashes in config['files'].items():
            if digest(target / name) != hashes['before']:
                raise ValueError('baseline changed during staging: ' + name)
        backup = target / ('.lease-backup-' + uuid.uuid4().hex)
        backup.mkdir(mode=0o700)
        for name in expected:
            if (target / name).exists():
                shutil.copy2(target / name, backup / name)
        changed = []
        try:
            # 守卫先落地，停下的 watcher 恢复后才能消费新入口。
            for name in [*config['guards'], *config['files']]:
                os.replace(stage / name, target / name)
                changed.append(name)
            for name, sha in expected.items():
                if digest(target / name) != sha:
                    raise ValueError('installed output hash mismatch: ' + name)
        except BaseException:
            for name in reversed(changed):
                if (backup / name).exists():
                    shutil.copy2(backup / name, target / name)
                else:
                    (target / name).unlink(missing_ok=True)
            raise
        return result | {'installed':True, 'backup':str(backup)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    parser.add_argument('--group', choices=['node','python'], required=True)
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args()
    print(json.dumps(apply(pathlib.Path(__file__).parent, args.target, args.group, args.install)))
