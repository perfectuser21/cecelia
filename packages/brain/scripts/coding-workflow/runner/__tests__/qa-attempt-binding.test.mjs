import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useQaEnv, FAKE_EVALUATE } from './helpers/qa-env.mjs';

// 真实 runner + 临时 Git/HTTP；凭证有效性由 core/source-provenance 集成另验。
describe('QA 原生阶段身份跨裁判重试保持', () => {
  const E = useQaEnv();
  const stageId = '72624c5f-835d-4c50-9568-8776857adfe8';
  const evaluateWithId = () => {
    const file = path.join(E.sb.root, 'evaluate-stage-id.mjs');
    const source = fs.readFileSync(FAKE_EVALUATE, 'utf8');
    expect(source).toContain('outputs: { qa_report_file: file, qa:');
    fs.writeFileSync(file, source.replace('outputs: { qa_report_file: file, qa:',
      `outputs: { source_stage_event_id: ${JSON.stringify(stageId)}, qa_report_file: file, qa:`));
    return file;
  };
  it('新鲜evaluate成功后将实际控制器阶段ID随正式轮次保存', async () => {
    const result = await E.go(E.green(), { extra: { CODING_WF_EVALUATE: evaluateWithId() } });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(E.state().rounds).toHaveLength(1);
    expect(E.state().rounds[0].source_stage_event_id).toBe(stageId);
  });
  it('裁判不可用先提交05，再跨工作区仅重试裁判，保留原QA阶段及测试HEAD', async () => {
    const head = E.remoteHead();
    E.judge.mode = 'http500';
    const first = await E.go(E.green(), { extra: { CODING_WF_EVALUATE: evaluateWithId() } });
    expect(first.exitCode, first.stderr).toBe(0);
    expect(E.state()).toMatchObject({ judge_pending: true, rounds: [{ head, source_stage_event_id: stageId }] });
    const recordHead = E.remoteHead();
    expect(recordHead).not.toBe(head);
    await E.closeBrain();E.judge.mode = 'pass';
    const second = await E.go(E.green({ prs: [E.pr({ headRefOid: recordHead })] }));
    expect(second.exitCode, second.stderr).toBe(0);
    expect(E.qaCalls()).toHaveLength(1);
    expect(E.state()).toMatchObject({ passed: true, judge_pending: false,
      rounds: [{ head, source_stage_event_id: stageId, judge: { verdict: 'PASS' } }] });
  });
});
