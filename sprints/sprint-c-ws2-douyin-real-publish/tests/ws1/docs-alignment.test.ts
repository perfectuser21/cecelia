import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SKILL_MD = resolve(ROOT, 'packages/workflows/skills/douyin-publisher/SKILL.md');
const FIELDS_MD = resolve(ROOT, 'packages/workflows/skills/douyin-publisher/FIELDS.md');
const JOURNEY_MD = resolve(ROOT, '.agent-knowledge/content-pipeline-douyin/journey.md');

describe('Workstream 1 — 三份文档对齐 [BEHAVIOR]', () => {
  it('SKILL.md 不再含历史 NAS 路径 ~/.douyin-queue', () => {
    const content = readFileSync(SKILL_MD, 'utf8');
    const matches = content.match(/~\/\.douyin-queue/g) || [];
    expect(matches.length).toBe(0);
  });

  it('SKILL.md 含统一 NAS 路径 creator/output/douyin/', () => {
    const content = readFileSync(SKILL_MD, 'utf8');
    expect(content).toMatch(/creator\/output\/douyin\//);
  });

  it('SKILL.md 显式描述 SCP 跨机跳板架构（含 xian-mac 跳板字样）', () => {
    const content = readFileSync(SKILL_MD, 'utf8');
    const hasJumpHost =
      /xian-mac.*跳板/.test(content) ||
      /跳板.*xian-mac/.test(content) ||
      /xian-mac.*SCP/.test(content) ||
      /SCP.*xian-mac/.test(content);
    expect(hasJumpHost).toBe(true);
  });

  it('FIELDS.md 含 video 类型必填字段（title.txt 与 video.mp4）', () => {
    const content = readFileSync(FIELDS_MD, 'utf8');
    expect(content).toContain('title.txt');
    expect(content).toContain('video.mp4');
  });

  it('FIELDS.md 含退出码 0/1/2 三态完整定义', () => {
    const content = readFileSync(FIELDS_MD, 'utf8');
    expect(content).toMatch(/exit\s+0/);
    expect(content).toMatch(/exit\s+1/);
    expect(content).toMatch(/exit\s+2/);
  });

  it('.agent-knowledge/content-pipeline-douyin/journey.md 文件存在', () => {
    expect(existsSync(JOURNEY_MD)).toBe(true);
  });

  it('journey.md 含 journey_type=agent_remote', () => {
    const content = readFileSync(JOURNEY_MD, 'utf8');
    expect(content).toContain('agent_remote');
  });

  it('journey.md 含 8 步 Journey 定义（Step 1 到 Step 8 至少 8 个标记）', () => {
    const content = readFileSync(JOURNEY_MD, 'utf8');
    const steps = content.match(/Step\s*[1-8]/gi) || [];
    expect(steps.length).toBeGreaterThanOrEqual(8);
  });
});
