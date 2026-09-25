/**
 * skill 清单（manifest）：生成器脚本 + JS 纯逻辑（链 bf5088a3 棒8，任务 1141f101）
 * 脚本真跑 bash（临时目录夹具，不发 ssh）；JS 侧校验解析/比对。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseManifestOutput,
  verifyTreeHash,
  treeHashOf,
  compareManifests,
} from '../lib/skill-manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, '../lib/skill-manifest.sh');
const WRAPPER = resolve(here, '../../../../scripts/skill-manifest.sh');

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'skill-manifest-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function put(rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

function run(dir, { env = {}, script = SCRIPT } = {}) {
  const r = spawnSync('bash', [script, dir], { encoding: 'utf8', env: { ...process.env, ...env } });
  const last = r.stdout ? r.stdout.trim().split('\n').pop() : null;
  return { code: r.status, out: r.stdout, err: r.stderr, json: last ? JSON.parse(last) : null };
}

function fixture() {
  put('skills/alpha/SKILL.md', '# alpha\n');
  put('skills/alpha/scripts/run.sh', 'echo hi\n');
  put('skills/beta/SKILL.md', '# beta\n');
  return join(root, 'skills');
}

describe('skill-manifest.sh 确定性', () => {
  it('输出结构完整：skills/broken/count/tree_hash，且 tree_hash 能被 JS 重算', () => {
    const dir = fixture();
    const { code, json } = run(dir);
    expect(code).toBe(0);
    expect(json.version).toBe(1);
    expect(json.count).toBe(2);
    expect(Object.keys(json.skills)).toEqual(['alpha', 'beta']);
    expect(json.broken).toEqual([]);
    expect(json.skills.alpha).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTreeHash(json)).toBe(true);
  });

  it('同内容不同 mtime → 哈希完全相同（mtime 不参与）', () => {
    const dir = fixture();
    const a = run(dir).json;
    const old = new Date('2001-01-01T00:00:00Z');
    for (const f of ['alpha/SKILL.md', 'alpha/scripts/run.sh', 'beta/SKILL.md']) utimesSync(join(dir, f), old, old);
    const b = run(dir).json;
    expect(b.skills).toEqual(a.skills);
    expect(b.tree_hash).toBe(a.tree_hash);
  });

  it('同内容换个位置拷贝 → 哈希相同（路径前缀不参与）', () => {
    const dir = fixture();
    const copy = join(root, 'elsewhere', 'deep');
    cpSync(dir, copy, { recursive: true });
    expect(run(copy).json.tree_hash).toBe(run(dir).json.tree_hash);
  });

  it('改一个字节 → 该 skill 与 tree_hash 变，其余 skill 不变', () => {
    const dir = fixture();
    const a = run(dir).json;
    writeFileSync(join(dir, 'alpha/scripts/run.sh'), 'echo ho\n');
    const b = run(dir).json;
    expect(b.skills.alpha).not.toBe(a.skills.alpha);
    expect(b.skills.beta).toBe(a.skills.beta);
    expect(b.tree_hash).not.toBe(a.tree_hash);
  });

  it('文件改名（内容不变）也算变化', () => {
    const dir = fixture();
    const a = run(dir).json;
    rmSync(join(dir, 'beta/SKILL.md'));
    writeFileSync(join(dir, 'beta/SKILL2.md'), '# beta\n');
    expect(run(dir).json.skills.beta).not.toBe(a.skills.beta);
  });

  it('忽略 .DS_Store / node_modules / .git / __pycache__ 与顶层隐藏项、顶层普通文件', () => {
    const dir = fixture();
    const a = run(dir).json;
    put('skills/alpha/.DS_Store', 'junk');
    put('skills/alpha/node_modules/x/index.js', 'junk');
    put('skills/alpha/.git/HEAD', 'ref');
    put('skills/alpha/scripts/__pycache__/run.cpython-310.pyc', 'bytecode');
    put('skills/.git/HEAD', 'ref');
    put('skills/.gitignore', 'x');
    put('skills/README.md', 'top file');
    const b = run(dir).json;
    expect(b.skills).toEqual(a.skills);
    expect(b.count).toBe(2);
    expect(b.tree_hash).toBe(a.tree_hash);
  });

  it('含空格/中文文件名不炸，且被计入哈希', () => {
    const dir = fixture();
    const a = run(dir).json;
    put('skills/beta/参考 资料.md', 'x');
    const b = run(dir).json;
    expect(b.skills.beta).not.toBe(a.skills.beta);
  });
});

describe('skill-manifest.sh 符号链接（09-25 实测病根：MMV 的 skill 几乎全是符号链接）', () => {
  it('指向目录的符号链接被跟随：与同内容真目录哈希一致', () => {
    const real = join(root, 'store/gamma');
    put('store/gamma/SKILL.md', '# gamma\n');
    put('copy/gamma/SKILL.md', '# gamma\n');
    mkdirSync(join(root, 'linkfarm'), { recursive: true });
    symlinkSync(real, join(root, 'linkfarm/gamma'));
    const viaLink = run(join(root, 'linkfarm')).json;
    const viaReal = run(join(root, 'copy')).json;
    expect(viaLink.skills.gamma).toBe(viaReal.skills.gamma);
    expect(viaLink.tree_hash).toBe(viaReal.tree_hash);
  });

  it('悬空符号链接进 broken 单列、不进 skills、不计 count；tree_hash 只代表有内容的 skill（不被悬空项污染）', () => {
    const dir = fixture();
    const before = run(dir).json;
    symlinkSync('/nonexistent/path/zzz', join(dir, 'zzz'));
    const after = run(dir).json;
    expect(after.broken).toEqual(['zzz']);
    expect(after.skills.zzz).toBeUndefined();
    expect(after.count).toBe(2);
    expect(after.tree_hash).toBe(before.tree_hash);
    expect(verifyTreeHash(after)).toBe(true);
  });
});

describe('skill-manifest.sh 目录与参数', () => {
  it('目录不存在：退出 3 且输出 dir_missing（不是空清单）', () => {
    const { code, json } = run(join(root, 'nope'));
    expect(code).toBe(3);
    expect(json.error).toBe('dir_missing');
    expect(json.skills).toBeUndefined();
  });

  it('目录存在但为空：合法的零个 skill（与目录不存在区分）', () => {
    mkdirSync(join(root, 'empty'));
    const { code, json } = run(join(root, 'empty'));
    expect(code).toBe(0);
    expect(json.count).toBe(0);
    expect(verifyTreeHash(json)).toBe(true);
  });

  it('@home/ 前缀按目标机 HOME 展开（避免调用方 shell 提前把 ~ 展成自己的家目录）', () => {
    fixture();
    const { code, json } = run('@home/skills', { env: { HOME: root } });
    expect(code).toBe(0);
    expect(json.count).toBe(2);
  });

  it('scripts/skill-manifest.sh 薄包装与本体输出一致', () => {
    const dir = fixture();
    const a = run(dir).json;
    const b = run(dir, { script: WRAPPER }).json;
    expect(b.tree_hash).toBe(a.tree_hash);
  });
});

describe('parseManifestOutput', () => {
  const good = () => {
    const skills = { a: 'a'.repeat(64), b: 'b'.repeat(64) };
    return { version: 1, dir: '/x', host: 'h', count: 2, skills, broken: [], tree_hash: treeHashOf(skills) };
  };

  it('合法输出通过，且容忍 ssh banner/噪声行（取最后一个 JSON 行）', () => {
    const m = good();
    const r = parseManifestOutput(`Welcome to Foo\nwarning: x\n${JSON.stringify(m)}\n`);
    expect(r.ok).toBe(true);
    expect(r.manifest.count).toBe(2);
  });

  it('dir_missing 输出 → ok=false, reason=dir_missing', () => {
    const r = parseManifestOutput('{"version":1,"error":"dir_missing","dir":"/x"}\n');
    expect(r).toMatchObject({ ok: false, reason: 'dir_missing' });
  });

  it('空输出 / 非 JSON / 缺字段 / 版本不对 → invalid（不是零个 skill）', () => {
    for (const raw of ['', 'garbage', '{}', '{"version":1}', '{"version":2,"skills":{},"broken":[],"tree_hash":"x"}']) {
      const r = parseManifestOutput(raw);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('invalid');
    }
  });

  it('tree_hash 对不上（输出被截断/篡改）→ invalid', () => {
    const m = good();
    delete m.skills.b;
    expect(parseManifestOutput(JSON.stringify(m))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('skill 哈希不是 64 位十六进制 → invalid', () => {
    const m = good();
    m.skills.a = 'nothex';
    m.tree_hash = treeHashOf(m.skills);
    expect(parseManifestOutput(JSON.stringify(m)).ok).toBe(false);
  });
});

describe('compareManifests', () => {
  const H = (c) => c.repeat(64);
  const mk = (skills, broken = []) => ({ skills, broken, tree_hash: treeHashOf(skills), count: Object.keys(skills).length });

  it('完全一致 → in_sync', () => {
    const t = mk({ a: H('1'), b: H('2') });
    expect(compareManifests(t, mk({ a: H('1'), b: H('2') }))).toMatchObject({ in_sync: true, missing: [], extra: [], changed: [], broken: [] });
  });

  it('缺失 / 多余 / 哈希不同 / 悬空 分别归类', () => {
    const truth = mk({ a: H('1'), b: H('2'), c: H('3'), d: H('4') });
    const other = mk({ a: H('1'), b: H('9'), x: H('5') }, ['d']);
    const d = compareManifests(truth, other);
    expect(d.in_sync).toBe(false);
    expect(d.missing).toEqual(['c']);
    expect(d.changed).toEqual(['b']);
    expect(d.extra).toEqual(['x']);
    expect(d.broken).toEqual(['d']);
  });

  it('对方零个 skill 但真身有 → 全部 missing（真实的空目录）', () => {
    expect(compareManifests(mk({ a: H('1'), b: H('2') }), mk({})).missing).toEqual(['a', 'b']);
  });

  it('真身自己的悬空链接不算对方 missing，单独报 truth_broken 且不算 in_sync', () => {
    const d = compareManifests(mk({ a: H('1') }, ['z']), mk({ a: H('1') }));
    expect(d.missing).toEqual([]);
    expect(d.truth_broken).toEqual(['z']);
  });
});
