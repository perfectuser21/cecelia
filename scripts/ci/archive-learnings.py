#!/usr/bin/env python3
"""按 Git 首次入库月份合并 learning；验证所有桶后才替换归档和移除原文件。"""
import datetime
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def read_archive(path):
    entries = {}
    if path.is_symlink():
        raise ValueError(f'归档不能是符号链接: {path}')
    if path.exists():
        with tarfile.open(path, 'r:gz') as archive:
            for member in archive:
                name = member.name
                if not member.isfile() or Path(name).name != name or not name.endswith('.md'):
                    raise ValueError(f'归档成员必须是顶层普通 Markdown: {name}')
                data = archive.extractfile(member).read()
                if name in entries and entries[name] != data:
                    raise ValueError(f'归档内部同名冲突: {name}')
                entries[name] = data
    return entries


def main():
    root = Path(git('rev-parse', '--show-toplevel'))
    learnings = root / 'docs/learnings'
    archive_dir = learnings / 'archive'
    archive_dir.mkdir(exist_ok=True)
    cutoff = time.time() - 30 * 86400
    buckets = {}
    for path in sorted(learnings.glob('*.md')):
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'learning 必须是普通文件: {path}')
        relative = str(path.relative_to(root))
        timestamp = git('log', '--follow', '--diff-filter=A', '--format=%at', '-1', '--', relative)
        if not timestamp or int(timestamp) >= cutoff:
            continue
        month = datetime.datetime.fromtimestamp(int(timestamp), datetime.timezone.utc).strftime('%Y-%m')
        buckets.setdefault(month, []).append(path)

    total = sum(map(len, buckets.values()))
    # staging 与目标在同一文件系统，任一桶损坏或同名冲突都不会覆盖任何原归档。
    with tempfile.TemporaryDirectory(prefix='.archive-stage-', dir=archive_dir) as temporary:
        staged = []
        for month, paths in sorted(buckets.items()):
            target = archive_dir / f'{month}.tar.gz'
            entries = read_archive(target)
            for path in paths:
                data = path.read_bytes()
                if path.name in entries and entries[path.name] != data:
                    raise ValueError(f'同名不同内容，拒绝覆盖历史证据: {path.name}')
                entries[path.name] = data
            output = Path(temporary) / target.name
            with tarfile.open(output, 'w:gz') as archive:
                for name, data in sorted(entries.items()):
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    member.mode = 0o644
                    archive.addfile(member, io.BytesIO(data))
            if read_archive(output) != entries:
                raise ValueError(f'归档写后校验失败: {target}')
            staged.append((output, target))
        for output, target in staged:
            os.replace(output, target)
        # 归档已读回所有字节后才删除；git rm 失败仍保有完整归档和原文件。
        for paths in buckets.values():
            subprocess.run(['git', 'rm', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'],
                           input=b''.join(os.fsencode(p.relative_to(root)) + b'\0' for p in paths), check=True)

    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'changed={str(total > 0).lower()}\ntotal_archived={total}\nbuckets={len(buckets)}\n')
    print(f'已安全归档 {total} 个 learning / {len(buckets)} 月桶')


if __name__ == '__main__':
    main()
