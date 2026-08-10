import { describe, expect, it } from 'vitest';
import { PIPELINE_TASK_TYPES, queueLaneSql } from '../task-queue-lanes.js';

describe('task queue lanes', () => {
  it('生成互斥的等待队列分类 SQL，并覆盖内容生产与 Harness 流水线', () => {
    const sql = queueLaneSql('candidate');

    expect(sql).toContain("candidate.status NOT IN ('queued','pending')");
    expect(sql).toContain("candidate.payload->>'headed_manual'");
    expect(sql).toContain("THEN 'ide'");
    expect(sql).toContain("THEN 'pipeline'");
    expect(sql).toContain("ELSE 'ready'");
    expect(PIPELINE_TASK_TYPES).toEqual(expect.arrayContaining([
      'content-pipeline',
      'content-review',
      'content_publish',
      'harness_ci_watch',
      'harness_deploy_watch',
    ]));
  });
});
