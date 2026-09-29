/**
 * 远端采集（Skill 台账投影 PR1a）：函数自包含，toString() 送 mmv 交给 node - 执行。
 * 这里用临时 HOME 造三平台 fixture 和一个假的 openclaw CLI，直接调用一次，再经 node - 真跑一次。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectSkillInventory, buildRemoteProgram, buildRemoteShell } from '../skill-inventory-remote.js';

let home;
const skill = (dir, name, body = '') => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} 描述\n---\n# ${name}\n${body}`);
};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'skinv-'));
  const repo = join(home, 'perfect21/zenithjoy-skills');
  skill(join(repo, 'alpha'), 'alpha', 'repo 原件');
  mkdirSync(join(repo, 'alpha/scripts'), { recursive: true });
  writeFileSync(join(repo, 'alpha/scripts/run.sh'), 'echo hi');
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  symlinkSync(join(repo, 'alpha'), join(home, '.claude/skills/alpha'));
  symlinkSync(join(repo, 'gone-away'), join(home, '.claude/skills/ghost'));
  skill(join(home, '.claude/skills/local-only'), 'local-only');
  skill(join(home, '.agents/skills/superpowers/brainstorming'), 'brainstorming');
  const ws = join(home, 'openclaw-root/workspaces-root/clawd-a');
  skill(join(ws, 'skills/alpha'), 'alpha', '旧副本');
  skill(join(ws, 'skills/beta'), 'beta');
  mkdirSync(join(home, '.openclaw'), { recursive: true });
  writeFileSync(join(home, '.openclaw/openclaw.json'), JSON.stringify({ agents: { entries: {
    a: { workspace: ws, skills: ['beta'] }, b: { workspace: ws },
  } } }));
  const bin = join(home, 'fake-openclaw');
  writeFileSync(bin, `#!/bin/sh
case "$4" in
  a|b) printf '%s' '{"workspaceDir":"${ws}","managedSkillsDir":"${home}/.openclaw/skills","skills":[{"name":"alpha","source":"openclaw-workspace"},{"name":"beta","source":"openclaw-workspace"},{"name":"brainstorming","source":"agents-skills-personal"},{"name":"weather","source":"openclaw-bundled"}]}' ;;
  *) exit 3 ;;
esac
`);
  chmodSync(bin, 0o755);
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const opts = () => ({ home, openclawBin: join(home, 'fake-openclaw'), budgetMs: 20_000, agentTimeoutMs: 5_000 });

describe('collectSkillInventory', () => {
  it('Claude Code：跟随软链收有效 skill，悬空软链单列 broken', async () => {
    const inv = await collectSkillInventory(opts());
    expect(inv.ok).toBe(true);
    const c = inv.sources.claude;
    expect(c.status).toBe('ok');
    expect(c.items.map((i) => i.name).sort()).toEqual(['alpha', 'local-only']);
    expect(c.broken).toEqual(['ghost']);
    const alpha = c.items.find((i) => i.name === 'alpha');
    expect(alpha.real_path).toContain('zenithjoy-skills/alpha/SKILL.md');
    expect(alpha.files).toEqual(expect.arrayContaining(['SKILL.md', 'scripts/run.sh']));
    expect(inv.contents[alpha.digest]).toContain('repo 原件');
  });

  it('~/.agents/skills 支持一层分组；repo 只看根目录一层', async () => {
    const inv = await collectSkillInventory(opts());
    expect(inv.sources.agents.items.map((i) => i.name)).toEqual(['brainstorming']);
    expect(inv.sources.repo.items.map((i) => i.name)).toEqual(['alpha']);
  });

  it('OpenClaw：只收自有来源、同路径合并 agents、按白名单或 workspace 记 assigned', async () => {
    const oc = (await collectSkillInventory(opts())).sources.openclaw;
    expect(oc.status).toBe('ok');
    expect(oc.items.map((i) => i.name).sort()).toEqual(['alpha', 'beta', 'brainstorming']);
    const beta = oc.items.find((i) => i.name === 'beta');
    expect(beta.agents.sort()).toEqual(['a', 'b']);
    expect(beta.assigned.sort()).toEqual(['a', 'b']);
    const bs = oc.items.find((i) => i.name === 'brainstorming');
    expect(bs.assigned).toEqual([]);
    expect(oc.items.find((i) => i.name === 'weather')).toBeUndefined();
  });

  it('任一 agent 失败 → openclaw 整体 fail，不给部分结果；claude 根目录缺失 → fail', async () => {
    writeFileSync(join(home, '.openclaw/openclaw.json'), JSON.stringify({ agents: { entries: { a: {}, zzz: {} } } }));
    const inv = await collectSkillInventory(opts());
    expect(inv.sources.openclaw.status).toBe('fail');
    expect(inv.sources.openclaw.items).toBeUndefined();
    const inv2 = await collectSkillInventory({ ...opts(), home: join(home, 'nope') });
    expect(inv2.sources.claude.status).toBe('fail');
  });
});

describe('buildRemoteProgram', () => {
  it('函数体自包含：不含 import( 与 vitest 改写痕迹', () => {
    const src = collectSkillInventory.toString();
    expect(src).not.toMatch(/\bimport\(/);
    expect(src).not.toMatch(/__vite_ssr|__vi_/);
  });

  it('base64 后 ≤ 90KB（Linux 单参数 128KB 上限留余量）', () => {
    const b64 = Buffer.from(buildRemoteProgram(opts())).toString('base64');
    expect(b64.length).toBeLessThan(90 * 1024);
  });

  it('经 node - 真跑输出合法 JSON', () => {
    const out = execFileSync('node', ['-'], { input: buildRemoteProgram(opts()), encoding: 'utf8' });
    const inv = JSON.parse(out);
    expect(inv.ok).toBe(true);
    expect(inv.sources.claude.items.length).toBeGreaterThan(0);
  });

  it('远端 shell 带 PATH 并用 base64 送达（命令行里没有单引号）', () => {
    const sh = buildRemoteShell('console.log(1)');
    expect(sh).toMatch(/^export PATH=\/opt\/homebrew\/bin:\/usr\/local\/bin:\$PATH; echo [A-Za-z0-9+/=]+ \| \(base64 -d 2>\/dev\/null \|\| base64 -D\) \| node -$/);
  });
});
