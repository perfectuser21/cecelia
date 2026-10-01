import { expect, it } from 'vitest';
import { parseCommanderProfile } from '../../../packages/brain/src/orchestrator/commander-profile.js';

it('keeps the registered public authorization intact at the task to Commander boundary', () => {
  const task = { payload: {
    lane: 'AI', repo: 'cecelia', actor: 'codex',
    branch: 'cp-1001-contract-context',
    base_sha: '675f80f874396d8972a894420ecec0cf0ad357c1',
    map_scope: ['F1', 'MJ5'], work_kind: 'coding_mutation',
    sprint_dir: 'sprints', change_kind: 'bugfix',
    routing_receipt_id: '464d91b8-a7f1-4385-8a15-9e5d4a7b28ba',
    user_authorization: '用户授权继续未完成与原始bug；本棒是实际native gate所需缺上下文修复',
  } };
  const before = structuredClone(task.payload);
  const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: task.payload });
  expect(profile.mode).toBe('hybrid');
  expect(profile.commander.primary.role).toBe('commander');
  expect(task.payload).toEqual(before);
  expect(() => parseCommanderProfile({
    commanderMode: 'hybrid',
    payload: { ...task.payload, access_token: 'fixture-only-value' },
  })).toThrow('secret_material_forbidden');
});
