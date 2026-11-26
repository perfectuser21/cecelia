import { it, expect } from 'vitest';
import { assertJanitorAuthority } from '../janitor-authority.js';
import { routeWork } from '../work-router.js';
import { createRoutedTask } from '../work-routing-store.js';
import { IMAGE_RETENTION_AUTHORITY, IMAGE_RETENTION_POLICY, IMAGE_RETENTION_MACHINE } from '../image-retention-authority.js';
import { TASK_TYPE_REGISTRY } from '../lib/task-type-registry.js';
const image = { source: 'scheduler', source_id: 'fixture', title: '回收自有镜像', declared_domain: 'operations', mutation_intent: 'write', requested_task_type: 'janitor', task: { executor_kind: 'image-janitor' }, metadata: { policy: IMAGE_RETENTION_POLICY, machine_registry_id: IMAGE_RETENTION_MACHINE } };
it('现役Janitor注册表归镜像执行器，普通任务无附加能力', () => {
  expect(TASK_TYPE_REGISTRY.janitor).toMatchObject({ executor: 'image-janitor', tick_dispatchable: false, cleanup_class: 'protected' });
  expect(assertJanitorAuthority({requested_task_type: 'data'})).toBe(false);
  expect(routeWork(image, [], {imageRetentionAuthority: IMAGE_RETENTION_AUTHORITY})).toMatchObject({work_kind: 'operations', artifact_kind: 'execution'});
});
it.each([
  { requested_task_type: 'janitor' },
  { metadata: {policy: IMAGE_RETENTION_POLICY, machine_registry_id: IMAGE_RETENTION_MACHINE} },
  { metadata: {policy: 'preview-owned-npm-cache-expiry-v1', machine: 'mmv'} },
  { task: {task_type: 'janitor'} },
  { executor_kind: 'preview-janitor' },
  { task: {executor_kind: 'preview-janitor'} },
  { executor_kind: 'image-janitor' },
  { task: {executor_kind: 'image-janitor'} },
])('外部保留类型不能降格绕过中央路由及writer：%o', async reserved => {
  const request = {...image, mutation_intent: 'read_only', artifact_kind: 'execution', requested_task_type: 'data', task: {}, ...reserved, metadata: reserved.metadata ?? {}};
  for (const context of [{}, {previewCacheAuthority: 'spoofed'}, {imageRetentionAuthority: IMAGE_RETENTION_AUTHORITY}]) {
    expect(() => routeWork(request, [], context)).toThrow('janitor_authority_required');
    await expect(createRoutedTask({}, request, [], context)).rejects.toThrow('janitor_authority_required');
  }
});
