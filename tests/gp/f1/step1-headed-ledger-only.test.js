import { describe, it, expect } from 'vitest';
import { routeWork } from '../../../packages/brain/src/work-router.js';
import { assertTaskTypeHasExecutor } from '../../../packages/brain/src/lib/dispatch-route.js';

const FACTS = [{ repo: 'cecelia', scope_key: 'cecelia', aliases: ['perfectuser21/cecelia'] }];

describe('GP F1 step1 — 有头开发使用通用账本', () => {
  it('有头开发归dev，建单闸认可当前会话执行者', () => {
    const payload={headed_manual:'true'};
    const route=routeWork({source:'conversation',source_id:'owned-headed-ledger',title:'修复Brain调度错误',work_kind:'coding_mutation', mutation_intent:'write', declared_change_kind:'bugfix', repo_hint:'cecelia', map_scope_hint:['F1'], task:{task_type:'dev',status:'in_progress',payload}},FACTS);
    expect(route).toMatchObject({canonical_task_type:'dev',orchestrator:'headed-session'});
    expect(()=>assertTaskTypeHasExecutor({task_type:route.canonical_task_type,status:'in_progress',payload})).not.toThrow();
  });
});
