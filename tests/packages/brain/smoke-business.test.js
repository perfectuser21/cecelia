import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SMOKE_SCRIPT = path.resolve(REPO_ROOT, 'packages/brain/scripts/smoke/smoke-business.sh');

describe('smoke-business.sh 结构验证', () => {
  it('文件存在', () => {
    expect(fs.existsSync(SMOKE_SCRIPT)).toBe(true);
  });

  it('文件可执行', () => {
    const stat = fs.statSync(SMOKE_SCRIPT);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it('包含 ok/fail/section 函数', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('ok()');
    expect(c).toContain('fail()');
    expect(c).toContain('section()');
  });

  it('包含 Brain-only feature 断言标签（抽样 30 个）', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    const features = [
      // alertness
      'alertness-get', 'alertness-override', 'alertness-diagnosis',
      // analytics
      'analytics-collection', 'analytics-roi', 'analytics-platform',
      // okr
      'okr-current', 'okr-progress', 'okr-create', 'okr-update',
      // dashboard
      'dashboard-roadmap', 'dashboard-tasks', 'dashboard-settings',
      // quarantine
      'quarantine-stats', 'quarantine-view', 'quarantine-release',
      // desire
      'desire-list', 'desire-stats',
      // memory
      'memory-search', 'memory-rumination',
      // pipeline
      'pipeline-list', 'pipeline-create',
      // publish
      'wechat-publisher', 'douyin-publisher',
      // external service features
      'agent-register', 'scraper-wechat', 'license-create',
      'creator-health', 'label-admin',
    ];
    for (const f of features) {
      expect(c, `缺少 feature: ${f}`).toContain(f);
    }
  });

  it('包含外部服务可用性检查', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('ZJ_UP');
    expect(c).toContain('CREATOR_UP');
  });

  it('包含 exit 0/1 退出逻辑', () => {
    const c = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(c).toContain('exit 0');
    expect(c).toContain('exit 1');
  });
});
