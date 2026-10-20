import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { useQaEnv, TASK } from './helpers/qa-env.mjs';

describe('预览停止必须核实业务回执', () => {
  const E = useQaEnv();
  const pending = () => JSON.parse(fs.readFileSync(path.join(E.sb.logDir, 'pr-sync-pending.json'), 'utf8')).entries['77'];
  const stops = () => E.preview.calls.filter((c) => c.url === '/api/brain/preview/stop/77');
  const task = () => ({ id: TASK, status: 'completed', result: {} });
  const terminal = (state) => E.pr({ state, closedAt: '2026-10-15T00:00:00Z' });
  const gh = (pr) => ({ prs: [], [pr.state === 'MERGED' ? 'mergedPrs' : 'closedPrs']: [pr] });

  for (const state of ['MERGED', 'CLOSED']) {
    it(`${state} HTTP200 stopped=false 保留待办，窗口外下 tick stopped=true 才同步并清待办`, async () => {
      const pr = terminal(state);
      E.seedState({ passed: true, rounds: [], ...(state === 'MERGED' ? { merged: { head: E.head } } : {}) });
      E.preview.stopBody = { stopped: false, status: 'cleanup_failed', cleanup_detail: { remaining: ['process'] } };
      let r = await E.go(gh(pr), { tasks: [task()] });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(stops()).toHaveLength(1);
      expect.soft(E.state().preview_stopped).toBeUndefined();
      expect.soft(E.brain.tasks[0].result.qa_state.preview_stopped).toBeUndefined();
      expect.soft(pending()).toMatchObject({ pr: { number: 77, state } });
      const persisted = structuredClone(E.brain.tasks[0]);
      await E.closeBrain();
      // 正式 API 在已无活动预览时同样返回 stopped=true；历史列表已不含本 PR。
      E.preview.stopBody = { stopped: true, note: 'no active preview found' };
      const outsideWindow = { prs: [], mergedPrs: [], closedPrs: [], prDetails: { 77: pr } };
      r = await E.go(outsideWindow, { tasks: [persisted] });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(stops()).toHaveLength(2);
      expect(E.state().preview_stopped).toBe(true);
      expect(E.brain.tasks[0].result.qa_state.preview_stopped).toBe(true);
      expect(pending()).toBeUndefined();
      expect(E.brain.learnings).toHaveLength(0);
      expect(E.ghCalls().filter((a) => a[1] === 'merge')).toHaveLength(0);
    });
    it(`${state} 已确认停止后的独立重放不再停止或产生业务副作用`, async () => {
      const pr = terminal(state);
      // 上例真实读回验证这两个持久化结果；本例从已确认状态独立开始，不共享前例现场。
      const confirmed = { passed: true, rounds: [], preview_stopped: true,
        ...(state === 'MERGED' ? { merged: { head: E.head } } : {}) };
      E.seedState(confirmed);
      const savedTask = { ...task(), result: { qa_state: structuredClone(confirmed) } };
      const outsideWindow = { prs: [], mergedPrs: [], closedPrs: [], prDetails: { 77: pr } };
      const r = await E.go(outsideWindow, { tasks: [savedTask] });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(stops()).toHaveLength(0);
      expect(E.state().preview_stopped).toBe(true);
      expect(E.brain.tasks[0].result.qa_state.preview_stopped).toBe(true);
      expect(E.brain.learnings).toHaveLength(0);
      expect(E.ghCalls().filter((a) => a[1] === 'merge')).toHaveLength(0);
    });
  }

  for (const [label, reply] of [
    ['缺少 stopped', { stopBody: { ok: true } }],
    ['null', { stopBody: null }],
    ['非布尔 true', { stopBody: { stopped: 'true' } }],
    ['损坏 JSON', { stopRaw: '{' }],
    ['HTTP503 即使 stopped=true', { stop: 503, stopBody: { stopped: true } }],
  ]) {
    it(`${label} 不标记停止、不清待办`, async () => {
      Object.assign(E.preview, reply);
      const r = await E.go(gh(terminal('CLOSED')), { tasks: [task()] });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(stops()).toHaveLength(1);
      expect.soft(E.state().preview_stopped).toBeUndefined();
      expect.soft(E.brain.tasks[0].result.qa_state.preview_stopped).toBeUndefined();
      expect.soft(pending()).toMatchObject({ pr: { number: 77, state: 'CLOSED' } });
    });
  }
});
