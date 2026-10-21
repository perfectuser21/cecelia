import {it,expect,vi} from 'vitest';
import {ensureAssemblyGapTask} from './workflow-assembly-reconcile-tasks.js';
it.each(['candidate_environment_unsupported','candidate_isolation_required','resource_unknown','resource_unavailable','awaiting_execution'])('%s不递归派单且不查询数据库',async code=>{
 const db={query:vi.fn()};expect(await ensureAssemblyGapTask(db,{}, {gap:{code}})).toBeNull();expect(db.query).not.toHaveBeenCalled();
});
it('缺失身份与来源摘要不能建责任单',async()=>{
 const db={query:vi.fn()};await expect(ensureAssemblyGapTask(db,{}, {gap:{code:'unknown_gap'}})).rejects.toThrow('gap_task_identity_mismatch');expect(db.query).not.toHaveBeenCalled();
});
