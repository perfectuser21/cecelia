import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installDeps } from '../lib/worktree.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function workspace(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-skill-bootstrap-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, '.skills-source.json'), '{}');
  fs.writeFileSync(path.join(root, 'scripts/ensure-skills-source.sh'), script);
  return root;
}
const dependencyInstall = { install: [process.execPath, '-e', "require('node:fs').writeFileSync('dependency-ready', 'yes')"] };

describe('新工作区的固定技能准备', () => {
  it('依赖安装后恢复技能，后续检查可读到技能正文', async () => {
    const root = workspace('set -eu\ntest -f dependency-ready\nmkdir -p "$1/packages/engine/skills/dev"\nprintf "pinned skill" > "$1/packages/engine/skills/dev/SKILL.md"\n');
    await installDeps(dependencyInstall, root);
    expect(fs.readFileSync(path.join(root, 'packages/engine/skills/dev/SKILL.md'), 'utf8')).toBe('pinned skill');
  });
  it('固定技能恢复失败时拒绝继续执行任务', async () => {
    const root = workspace('exit 9\n');
    await expect(installDeps(dependencyInstall, root)).rejects.toThrow('skill_source_restore_failed');
  });
  it('只跳过npm安装时仍准备固定技能', async () => {
    const root = workspace('set -eu\ntest ! -f dependency-ready\nprintf ready > skill-ready\n');
    await installDeps({ ...dependencyInstall, skipNpmCi: true }, root);
    expect(fs.readFileSync(path.join(root, 'skill-ready'), 'utf8')).toBe('ready');
  });
  it('没有固定技能声明的仓库不执行恢复脚本', async () => {
    const root = workspace('exit 9\n');
    fs.unlinkSync(path.join(root, '.skills-source.json'));
    await expect(installDeps(dependencyInstall, root)).resolves.toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'dependency-ready'), 'utf8')).toBe('yes');
  });
});
