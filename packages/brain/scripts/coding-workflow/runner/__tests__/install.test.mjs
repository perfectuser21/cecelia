// install.sh：--dry-run 只打印将写入的 plist 与命令，不落盘、不调 launchctl；非 root 真装直接拒绝。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv } from './helpers/sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_SH = path.join(HERE, '../install.sh');
const LABEL = 'com.cecelia.coding-workflow-runner';
const TOOLS = ['node', 'git', 'gh', 'claude'];

function runInstall(args, env) {
  return spawnSync('bash', [INSTALL_SH, ...args], { env, encoding: 'utf8', timeout: 30000 });
}

/** dry-run 输出里 plist 段落（<?xml 到 </plist>）。 */
function plistOf(stdout) {
  const start = stdout.indexOf('<?xml');
  const end = stdout.indexOf('</plist>');
  return stdout.slice(start, end + '</plist>'.length);
}

describe('install.sh', () => {
  let root;
  let toolDirs;
  let env;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-install-')));
    // 每个工具放在各自目录，验证 PATH 收齐了它们的真实所在目录
    toolDirs = TOOLS.map((tool) => {
      const dir = path.join(root, `bin-${tool}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      return dir;
    });
    env = {
      ...cleanTestEnv(),
      PATH: `${toolDirs.join(':')}:/usr/bin:/bin:/usr/sbin:/sbin`,
      CODING_WF_RUN_USER: 'administrator',
      CODING_WF_USER_HOME: path.join(root, 'home'),
    };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('--dry-run 打印系统域 LaunchDaemon plist：UserName、StartInterval=300、日志、PATH 含 node/git/gh/claude 目录、ProgramArguments 指向 clone 的 runner.sh', () => {
    const r = runInstall(['--dry-run'], env);
    expect(r.status, r.stderr).toBe(0);
    const home = path.join(root, 'home');
    const plist = plistOf(r.stdout);
    expect(r.stdout).toContain(`/Library/LaunchDaemons/${LABEL}.plist`);
    expect(r.stdout).not.toContain('Library/LaunchAgents');
    expect(plist).toContain(`<key>Label</key>\n  <string>${LABEL}</string>`);
    expect(plist).toContain('<key>UserName</key>\n  <string>administrator</string>');
    expect(plist).toContain('<key>StartInterval</key>\n  <integer>300</integer>');
    expect(plist).toContain('<key>ExitTimeOut</key>\n  <integer>240</integer>');
    expect(plist).toContain('<key>ProcessType</key>\n  <string>Standard</string>');
    expect(plist).toContain(`<key>CODING_WF_MAIN_LOG</key>\n    <string>${home}/Library/Logs/coding-workflow-runner.log</string>`);
    expect(plist).toContain(`<string>${home}/Library/Logs/coding-workflow-runner.log</string>`);
    expect(plist).toContain(`<string>${home}/perfect21/cecelia-cw-runner/packages/brain/scripts/coding-workflow/runner/runner.sh</string>`);
    expect(plist).toContain(`<key>HOME</key>\n    <string>${home}</string>`);
    const pathValue = /<key>PATH<\/key>\n\s*<string>([^<]+)<\/string>/.exec(plist)[1];
    for (const dir of toolDirs) expect(pathValue.split(':')).toContain(dir);
    expect(plist).not.toContain('__');

    // 将执行的命令
    expect(r.stdout).toContain(`launchctl bootstrap system /Library/LaunchDaemons/${LABEL}.plist`);
    expect(r.stdout).toContain(`launchctl enable system/${LABEL}`);

    // 不落盘：没有在用户 home 下建任何东西
    expect(fs.existsSync(home)).toBe(false);
  });

  it('dry-run 的 plist 是合法 plist（plutil -lint，macOS 才有）', () => {
    const plutil = spawnSync('sh', ['-c', 'command -v plutil'], { encoding: 'utf8' }).stdout.trim();
    const r = runInstall(['--dry-run'], env);
    expect(r.status, r.stderr).toBe(0);
    const file = path.join(root, 'out.plist');
    fs.writeFileSync(file, plistOf(r.stdout));
    if (!plutil) {
      expect(fs.readFileSync(file, 'utf8')).toMatch(/^<\?xml[\s\S]*<\/plist>$/);
      return;
    }
    const lint = spawnSync(plutil, ['-lint', file], { encoding: 'utf8' });
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
  });

  it('设置 CODING_WF_AUTOMERGE=0：写进 plist 的 EnvironmentVariables，且 plist 合法', () => {
    const r = runInstall(['--dry-run'], { ...env, CODING_WF_AUTOMERGE: '0' });
    expect(r.status, r.stderr).toBe(0);
    const plist = plistOf(r.stdout);
    const entry = '<key>CODING_WF_AUTOMERGE</key>\n    <string>0</string>';
    expect(plist).toContain(entry);
    const envStart = plist.indexOf('<key>EnvironmentVariables</key>');
    const envEnd = plist.indexOf('</dict>', envStart);
    expect(plist.indexOf(entry)).toBeGreaterThan(envStart);
    expect(plist.indexOf(entry)).toBeLessThan(envEnd);
    expect(plist).not.toContain('__');

    const plutil = spawnSync('sh', ['-c', 'command -v plutil'], { encoding: 'utf8' }).stdout.trim();
    const file = path.join(root, 'automerge.plist');
    fs.writeFileSync(file, plist);
    if (!plutil) {
      expect(fs.readFileSync(file, 'utf8')).toMatch(/^<\?xml[\s\S]*<\/plist>$/);
      return;
    }
    const lint = spawnSync(plutil, ['-lint', file], { encoding: 'utf8' });
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
  });

  it('CODING_WF_AUTOMERGE 值含 XML 特殊字符：转义后 plist 仍合法', () => {
    const r = runInstall(['--dry-run'], { ...env, CODING_WF_AUTOMERGE: 'a&b<c>' });
    expect(r.status, r.stderr).toBe(0);
    const plist = plistOf(r.stdout);
    expect(plist).toContain('<key>CODING_WF_AUTOMERGE</key>\n    <string>a&amp;b&lt;c&gt;</string>');
  });

  it('未设置 CODING_WF_AUTOMERGE：plist 不出现该键，也不留占位或空行', () => {
    const cleanEnv = { ...env };
    delete cleanEnv.CODING_WF_AUTOMERGE;
    const r = runInstall(['--dry-run'], cleanEnv);
    expect(r.status, r.stderr).toBe(0);
    const plist = plistOf(r.stdout);
    expect(plist).not.toContain('CODING_WF_AUTOMERGE');
    expect(plist).not.toContain('__');
    expect(plist).not.toContain('\n\n\n');
    expect(plist).not.toMatch(/\n\s*\n/);
  });

  it('CODING_WF_AUTOMERGE 为空串：等同未设置', () => {
    const r = runInstall(['--dry-run'], { ...env, CODING_WF_AUTOMERGE: '' });
    expect(r.status, r.stderr).toBe(0);
    const plist = plistOf(r.stdout);
    expect(plist).not.toContain('CODING_WF_AUTOMERGE');
    expect(plist).not.toContain('__');
  });

  // C5：多仓库——CODING_WF_REPOS 透传进 plist；已启用的其他仓库 clone 不存在时以运行用户身份 clone（clone 路径与 origin 取自 repos.json）
  it('CODING_WF_REPOS=cecelia,zj：写进 plist（合法），并为 zj 打印 sudo -u <用户> git clone；未设置时 plist 不出现该键', () => {
    // list-clones 要真 node 跑：把 node 桩换成真 node
    const nodeStub = path.join(toolDirs[0], 'node');
    fs.rmSync(nodeStub);
    fs.symlinkSync(process.execPath, nodeStub);
    const real = JSON.parse(fs.readFileSync(path.join(HERE, '../../repos.json'), 'utf8')).repos;
    const z = real.find((x) => x.key === 'zenithjoy-workspace');
    const reposFile = path.join(root, 'repos.json');
    const zjOrigin = path.join(root, 'zj.git');
    const zjClone = path.join(root, 'zj-clone');
    fs.writeFileSync(reposFile, JSON.stringify({ repos: [...real.filter((x) => x.key !== z.key),
      { ...z, key: 'zj', aliases: ['zj'], slug: 'acme/zj', origin: zjOrigin, clone: zjClone, worktree_base: path.join(root, 'wt-zj'), state_ns: 'zj', enabled: true }] }));
    const r = runInstall(['--dry-run'], { ...env, CODING_WF_REPOS: 'cecelia,zj', CODING_WF_REPOS_FILE: reposFile });
    expect(r.status, r.stderr).toBe(0);
    const plist = plistOf(r.stdout);
    expect(plist).toContain('<key>CODING_WF_REPOS</key>\n    <string>cecelia,zj</string>');
    expect(plist).not.toContain('__');
    expect(r.stdout).toContain(`sudo -u administrator git clone -q ${zjOrigin} ${zjClone}`);
    const plutil = spawnSync('sh', ['-c', 'command -v plutil'], { encoding: 'utf8' }).stdout.trim();
    if (plutil) {
      const file = path.join(root, 'repos.plist');
      fs.writeFileSync(file, plist);
      const lint = spawnSync(plutil, ['-lint', file], { encoding: 'utf8' });
      expect(lint.status, lint.stdout + lint.stderr).toBe(0);
    }
    // 只开 cecelia：不 clone zj
    const only = runInstall(['--dry-run'], { ...env, CODING_WF_REPOS: 'cecelia', CODING_WF_REPOS_FILE: reposFile });
    expect(only.status, only.stderr).toBe(0);
    expect(only.stdout).not.toContain(zjClone);
    const none = runInstall(['--dry-run'], env);
    expect(plistOf(none.stdout)).not.toContain('CODING_WF_REPOS');
  });

  it('缺工具（claude 不在 PATH）：报错退出，不输出 plist', () => {
    const r = runInstall(['--dry-run'], { ...env, PATH: `${toolDirs.slice(0, 3).join(':')}:/usr/bin:/bin` });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('claude');
    expect(r.stdout).not.toContain('<plist');
  });

  it('非 root 不带 --dry-run：拒绝真装', () => {
    if (process.getuid?.() === 0) return;
    const r = runInstall([], env);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('root');
  });

  it('未知参数：报错退出', () => {
    const r = runInstall(['--bogus'], env);
    expect(r.status).not.toBe(0);
  });
});
