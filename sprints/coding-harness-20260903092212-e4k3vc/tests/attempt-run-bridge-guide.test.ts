import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ROLES } from '../../../packages/brain/src/routes/harness-attempt-run.js';

const DOC = 'docs/current/attempt-run-bridge-guide.md';

async function readGuide() {
  return readFile(DOC, 'utf8');
}

function section(source: string, heading: string) {
  const match = source.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  expect(match, `缺少章节：${heading}`).not.toBeNull();
  return match?.[1] ?? '';
}

function codeItems(source: string) {
  return [...source.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('文档覆盖两个端点及鉴权', async () => {
    const auth = section(await readGuide(), '端点与鉴权');
    expect(auth).toContain('POST /api/brain/harness/attempt-run');
    expect(auth).toContain('GET /api/brain/harness/attempt-run/:id');
    expect(auth).toContain('internalAuthOrLoopback');
    expect(auth).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
    expect(auth).not.toMatch(/(?:宿主|远端).{0,12}(?:免鉴权|无需.{0,4}Bearer)/s);
  });

  it('角色白名单是恰好九项的封闭集合', async () => {
    const roles = codeItems(section(await readGuide(), '角色白名单'));
    expect([...new Set(roles)].sort()).toEqual([...ALLOWED_ROLES].sort());
    expect(roles).toHaveLength(9);
    expect(roles).not.toContain('commander');
    expect(roles).not.toContain('publisher');
  });

  it('payload 必填集合严格等于三项', async () => {
    const payload = section(await readGuide(), 'payload');
    const requiredLine = payload.split('\n').find((line) => line.startsWith('必填字段：')) ?? '';
    expect(codeItems(requiredLine).sort()).toEqual(['base_repo', 'branch', 'sprint_dir']);
    expect(requiredLine).not.toContain('`base_sha`');
    expect(payload).toMatch(/`base_sha`.{0,20}可省略/s);
    expect(payload).toMatch(/生产 Brain.{0,20}自解析/s);
  });

  it('派发失败回滚终态完整', async () => {
    const rollback = section(await readGuide(), '派发失败回滚');
    expect(rollback).toContain('run→failed/session→closed/task→cancelled');
    expect(rollback).not.toMatch(/run→(?:done|completed)|session→active|task→completed/);
  });

  it('实现 diff 仅有一页文档', async () => {
    const guide = await readGuide();
    expect(guide).toMatch(/[\u4e00-\u9fff]/);
    expect(guide).toContain('# attempt-run 桥接使用说明');
  });
});
