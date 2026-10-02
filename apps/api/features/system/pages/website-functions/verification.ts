import type { Verification } from './model';

// 来源：Brain 任务63728042的正式验收事实。读取与变更分别计数，不代表新建了两个Workflow。
export const verifications: Verification[] = [
  { operationId: 'BrainModelsPage:01', date: '2026-10-02', kind: 'query',
    evidence: 'Codex正式浏览器读取模型配置及当前模型通过，前端无页面异常；PR #5857，Brain任务63728042。此项只证明配置读取，不代表模型账号可以执行。' },
  { operationId: 'BrainModelsPage:03', date: '2026-10-02', kind: 'change',
    evidence: 'Codex保存现有thalamus相同模型值，配置读回及降级链保持一致；数据库事件2954031，回执46357393-8a32-4ee6-8d9f-52e53abe243d。PR #5857含修改/读回/事件失败回滚测试；未调用模型账号，也未实切其他生产模型。' },
];

export const growth = {
  date: '2026-10-02', newlyVerifiedChanges: 1,
  evidenceUrl: 'https://github.com/perfectuser21/cecelia/pull/5857',
  taskId: '63728042-77c3-47cb-9398-b0ecad90083b',
};
