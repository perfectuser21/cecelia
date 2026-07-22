import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearSkillBundleCacheForTests,
  loadRepositorySkillContent,
  loadSkillBundle,
} from '../skill-bundle.js';

const tempRoots = [];

function createSkill(name, content) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'cecelia-skill-bundle-'));
  tempRoots.push(repoRoot);
  const skillDir = path.join(repoRoot, 'packages', 'workflows', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  return repoRoot;
}

afterEach(() => {
  clearSkillBundleCacheForTests();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('loadSkillBundle', () => {
  it('从仓库快照冻结 Skill 的名称、版本、摘要和完整内容', () => {
    const content = [
      '---',
      'id: harness-planner',
      'version: 2.9.0',
      '---',
      'REPO_MARKER',
      '',
    ].join('\n');
    const repoRoot = createSkill('harness-planner', content);

    const bundle = loadSkillBundle('harness-planner', { repoRoot });

    expect(bundle).toMatchObject({
      name: 'harness-planner',
      version: '2.9.0',
      content,
    });
    expect(bundle.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(bundle.source_path).toBe(
      path.join(repoRoot, 'packages', 'workflows', 'skills', 'harness-planner', 'SKILL.md'),
    );
    expect(Object.isFrozen(bundle)).toBe(true);
  });

  it('同一文件在进程内返回相同的冻结快照', () => {
    const repoRoot = createSkill(
      'harness-reviewer',
      '---\nversion: 1.2.3\n---\nreview independently\n',
    );

    const first = loadSkillBundle('harness-reviewer', { repoRoot });
    const second = loadSkillBundle('harness-reviewer', { repoRoot });

    expect(second).toBe(first);
  });

  it('支持显式 skillsRoot，供容器挂载同一份只读快照', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cecelia-skills-root-'));
    tempRoots.push(root);
    const skillDir = path.join(root, 'harness-evaluator');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nversion: 4.0.0\n---\nevaluate\n',
      'utf8',
    );

    expect(loadSkillBundle('harness-evaluator', { skillsRoot: root }).version).toBe('4.0.0');
  });

  it('找不到 Skill 时 fail-fast', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'cecelia-skill-missing-'));
    tempRoots.push(repoRoot);

    expect(() => loadSkillBundle('missing-skill', { repoRoot })).toThrow(/SKILL\.md not found/);
  });

  it('拒绝路径穿越式 Skill 名称', () => {
    expect(() => loadSkillBundle('../outside')).toThrow(/invalid skill name/i);
  });

  it('缺少 frontmatter version 时拒绝冻结', () => {
    const repoRoot = createSkill('unversioned', '---\nid: unversioned\n---\ncontent\n');

    expect(() => loadSkillBundle('unversioned', { repoRoot })).toThrow(/version/i);
  });

  it('旧 Skill 可只读仓库正文，不放宽内核 bundle 的版本要求', () => {
    const content = '---\nid: legacy-skill\n---\nlegacy instructions\n';
    const repoRoot = createSkill('legacy-skill', content);

    expect(loadRepositorySkillContent('legacy-skill', { repoRoot })).toBe(content);
    expect(() => loadSkillBundle('legacy-skill', { repoRoot })).toThrow(/version/i);
  });
});
