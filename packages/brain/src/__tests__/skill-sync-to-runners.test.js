/**
 * scripts/skill-sync-to-runners.sh 集成测试（链 bf5088a3 棒8，任务 1141f101）
 * 真跑脚本 + 真 rsync，但 ssh 用假实现：把 host 别名映射成本地目录（HOME=该目录），绝不真连远端。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, lstatSync, existsSync, readFileSync, chmodSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const SYNC = resolve(here, '../../../../scripts/skill-sync-to-runners.sh');
const MANIFEST = resolve(here, '../lib/skill-manifest.sh');
const hasRsync = spawnSync('rsync', ['--version']).status === 0;

const FAKE_SSH = `#!/bin/bash
# 假 ssh：忽略选项，host 别名 -> $FAKE_REMOTE_ROOT/<host>，以其为 HOME 本地执行命令
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-i|-p|-l|-F) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
host="$1"; shift
if [ "$host" = down ]; then echo "ssh: connect to host down port 22: Connection refused" >&2; exit 255; fi
cd "$FAKE_REMOTE_ROOT/$host" || exit 255
export HOME="$PWD"
sh -c "$*"
rc=$?
if [ "$host" = flaky ] && [[ "$*" == *"rsync --server"* ]]; then echo junk > "$HOME/.claude/skills/alpha/junk.txt"; fi
exit $rc
`;

let root;
let env;

function put(rel, content = 'x\n') {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function isSymlink(p) { return lstatSync(p).isSymbolicLink(); }

function sync(args = [], extraEnv = {}) {
  const r = spawnSync('bash', [SYNC, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function manifestOf(dir) {
  const r = spawnSync('bash', [MANIFEST, dir], { encoding: 'utf8' });
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-sync-'));
  // 真身：MMV 形态——顶层全是符号链接，指向 store 里的真内容
  put('store/alpha/SKILL.md', '# alpha\n');
  put('store/alpha/scripts/run.sh', 'echo hi\n');
  put('store/beta/SKILL.md', '# beta\n');
  mkdirSync(join(root, 'src'));
  symlinkSync(join(root, 'store/alpha'), join(root, 'src/alpha'));
  symlinkSync(join(root, 'store/beta'), join(root, 'src/beta'));
  // 跑场机：cron 无 -L 留下的悬空链接 + 旧残留 + 目标自己的 .git
  for (const h of ['m4', 'm1', 'flaky']) {
    const s = join(root, 'remote', h, '.claude/skills');
    mkdirSync(s, { recursive: true });
    symlinkSync('/nonexistent/perfect21/zenithjoy-skills/alpha', join(s, 'alpha'));
    put(`remote/${h}/.claude/skills/old/SKILL.md`, '# stale\n');
    put(`remote/${h}/.claude/skills/.git/HEAD`, 'ref: refs/heads/main\n');
  }
  mkdirSync(join(root, 'remote/down'), { recursive: true });
  const fake = join(root, 'fake-ssh');
  writeFileSync(fake, FAKE_SSH);
  chmodSync(fake, 0o755);
  env = {
    ...process.env,
    SKILL_SYNC_SSH: fake,
    FAKE_REMOTE_ROOT: join(root, 'remote'),
    SKILL_SYNC_SRC: join(root, 'src'),
    SKILL_SYNC_TARGETS: 'm4 m1',
  };
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe.skipIf(!hasRsync)('skill-sync-to-runners.sh', () => {
  it('默认 dry-run：不写任何远端文件，但打印漂移与 rsync 命令（含 -L 与 .git 排除）', () => {
    const { code, out } = sync();
    expect(code).toBe(0);
    expect(out).toMatch(/dry-run/i);
    expect(out).toMatch(/rsync -azL/);
    expect(out).toContain('--exclude=.git');
    expect(out).not.toContain('--delete');
    // 远端原样：悬空链接还在、没有 codex 镜像目录
    const a = join(root, 'remote/m4/.claude/skills/alpha');
    expect(isSymlink(a)).toBe(true);
    expect(existsSync(join(root, 'remote/m4/.codex-gwremote'))).toBe(false);
    expect(out).toMatch(/m4/);
    expect(out).toMatch(/漂移|不一致|drift/);
  });

  it('--dry-run --prune 依旧不删任何东西，但命令里会带 --delete', () => {
    const { code, out } = sync(['--dry-run', '--prune']);
    expect(code).toBe(0);
    expect(out).toContain('--delete');
    expect(existsSync(join(root, 'remote/m4/.claude/skills/old/SKILL.md'))).toBe(true);
  });

  it('--apply（无 --prune）：把悬空链接换成真内容并镜像到 codex-gwremote，但不删多余项，因此以非零退出并提示 --prune', () => {
    const { code, out } = sync(['--apply']);
    const a = join(root, 'remote/m4/.claude/skills/alpha');
    expect(isSymlink(a)).toBe(false);
    expect(readFileSync(join(a, 'SKILL.md'), 'utf8')).toBe('# alpha\n');
    expect(readFileSync(join(a, 'scripts/run.sh'), 'utf8')).toBe('echo hi\n');
    expect(existsSync(join(root, 'remote/m4/.codex-gwremote/skills/alpha/SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'remote/m4/.claude/skills/old/SKILL.md'))).toBe(true); // 没 prune 就不删
    expect(code).toBe(1);
    expect(out).toContain('--prune');
  });

  it('--apply --prune：收敛到真身（多余项被删、目标 .git 保留），两个目录 manifest 与真身一致，退出 0', () => {
    const { code, out } = sync(['--apply', '--prune']);
    expect(out).not.toMatch(/❌/);
    expect(code).toBe(0);
    const truth = manifestOf(join(root, 'src'));
    for (const h of ['m4', 'm1']) {
      expect(existsSync(join(root, `remote/${h}/.claude/skills/old`))).toBe(false);
      expect(existsSync(join(root, `remote/${h}/.claude/skills/.git/HEAD`))).toBe(true);
      expect(manifestOf(join(root, `remote/${h}/.claude/skills`)).tree_hash).toBe(truth.tree_hash);
      expect(manifestOf(join(root, `remote/${h}/.codex-gwremote/skills`)).tree_hash).toBe(truth.tree_hash);
    }
  });

  it('再跑一次（幂等）：已一致仍退出 0', () => {
    expect(sync(['--apply', '--prune']).code).toBe(0);
    expect(sync(['--apply', '--prune']).code).toBe(0);
  });

  it('同步后目标与真身仍不一致（模拟目标上有进程在写）→ 退出 1 并点名该目标', () => {
    const { code, out } = sync(['--apply', '--prune'], { SKILL_SYNC_TARGETS: 'flaky' });
    expect(code).toBe(1);
    expect(out).toMatch(/flaky/);
    expect(out).toMatch(/不一致|❌/);
  });

  it('目标 ssh 不可达 → 退出 2，绝不当作零个 skill 去删/同步；其余目标照常处理', () => {
    const { code, out } = sync(['--apply', '--prune'], { SKILL_SYNC_TARGETS: 'down m1' });
    expect(code).toBe(2);
    expect(out).toMatch(/down[^\n]*(不可达|unreachable)/);
    expect(out).not.toMatch(/down[^\n]*缺失/);
    expect(existsSync(join(root, 'remote/m1/.claude/skills/alpha/SKILL.md'))).toBe(true);
  });

  it('真身里的悬空链接不会让 rsync 炸：按名排除、点名告警、并以非零退出（真身本身有病）', () => {
    symlinkSync('/nonexistent/zzz', join(root, 'src/zzz'));
    const { code, out } = sync(['--apply', '--prune']);
    expect(out).toContain('zzz');
    expect(existsSync(join(root, 'remote/m4/.claude/skills/alpha/SKILL.md'))).toBe(true);
    expect(code).not.toBe(0);
  });

  it('参数校验：--apply 与 --dry-run 互斥、未知参数报用法错（退出 64）', () => {
    expect(sync(['--apply', '--dry-run']).code).toBe(64);
    expect(sync(['--bogus']).code).toBe(64);
  });

  it('真身目录不存在 → 退出 2 且不碰任何目标', () => {
    const { code } = sync(['--apply', '--prune'], { SKILL_SYNC_SRC: join(root, 'nope') });
    expect(code).toBe(2);
    expect(isSymlink(join(root, 'remote/m4/.claude/skills/alpha'))).toBe(true);
  });
});
