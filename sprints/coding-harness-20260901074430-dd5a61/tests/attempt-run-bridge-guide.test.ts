import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ROLES } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const DOC_PATH = 'docs/current/attempt-run-bridge-guide.md';

function readGuide(): string {
  return readFileSync(DOC_PATH, 'utf8');
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('创建查询与远端鉴权说明完整', () => {
    const guide = readGuide();
    expect(guide).toContain('POST /api/brain/harness/attempt-run');
    expect(guide).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(guide).toContain('internalAuthOrLoopback');
    expect(guide).toContain('Bearer CECELIA_INTERNAL_TOKEN');
  });

  it('九项角色白名单精确且不增不减', () => {
    const guide = readGuide();
    const headingStart = guide.search(/^## .*角色白名单.*$/m);
    const afterHeading = headingStart < 0 ? '' : guide.slice(headingStart).replace(/^## .*\n/, '');
    const section = afterHeading.split(/^## /m, 1)[0];
    const documentedRoles = [...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]);
    expect(documentedRoles).toEqual([...ALLOWED_ROLES]);
    expect(documentedRoles).toHaveLength(9);
  });

  it('payload 必填与 base_sha 省略语义完整', () => {
    const guide = readGuide();
    expect(guide).toMatch(/sprint_dir.*必填/);
    expect(guide).toMatch(/base_repo.*必填/);
    expect(guide).toMatch(/branch.*必填/);
    expect(guide).toMatch(/base_sha.*(可省略|非必填)/);
    expect(guide).toMatch(/生产 Brain.*(自解析|解析)/);
  });

  it('派发失败三对象回滚终态完整', () => {
    const guide = readGuide();
    expect(guide).toMatch(/^## .*派发失败.*回滚/m);
    expect(guide).toMatch(/run.*(→|->).*failed/);
    expect(guide).toMatch(/session.*(→|->).*closed/);
    expect(guide).toMatch(/task.*(→|->).*cancelled/);
  });
});
