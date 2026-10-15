import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runRecordedActivity } from '../lib/activity-provenance.mjs';
import { runClaude } from '../lib/claude.mjs';
import { captureNativeExecution } from '../lib/record-provenance.mjs';

describe('实际活动结束时封存来源，不在 publish 补造', () => {
  let temp, worktree, root, input;
  const taskId = '11111111-2222-3333-4444-555555555555';
  const sprint = 'sprints/10160605-cw-11111111';
  const git = (...args) => execFileSync('git', ['-C', worktree, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8' });
  const options = (stage) => ({ stage, entry: import.meta.url, root });
  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-activity-proof-'));
    worktree = path.join(temp, 'repo'); root = path.join(temp, 'protected');
    fs.mkdirSync(worktree); git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.test');
    git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
    git('checkout', '-qb', 'cp-10160605-cw-11111111');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'base');
    fs.mkdirSync(path.join(worktree, sprint), { recursive: true });
    input = { worktree, task_id: taskId, sprint_dir: sprint, run_tag: 'activity-proof' };
  });
  afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));
  const intent = () => {
    fs.writeFileSync(path.join(worktree, sprint, '01-intent.md'), `---\ntask_id: ${taskId}\nstep: intent\nupstream: []\n---\n### I-1\n真实任务\n`);
    fs.writeFileSync(path.join(worktree, sprint, '01-invariants.md'), '# 铁律清单\n\n无相关铁律\n');
  };
  const files = () => fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter(p => p.endsWith('.json')) : [];
  it('控制器 intent 真实完成才保存阶段记录，结果保持原协议', async () => {
    const result = { status: 'completed', outputs: { intent_file: '01-intent.md' } };
    expect(await runRecordedActivity(input, options('intent'), async () => { intent(); return result; })).toEqual(result);
    expect(files().length).toBeGreaterThan(0);
  });
  it('活动失败即使留下看似正常文件，也不能封存 completed 阶段', async () => {
    const result = { status: 'failed', failure_class: 'fatal', reason_code: 'actual_validation_failed' };
    expect(await runRecordedActivity(input, options('intent'), async () => { intent(); return result; })).toEqual(result);
    const texts = files().map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    expect(texts).not.toContain('"kind":"stage"');
    expect(texts).not.toContain('"kind": "stage"');
  });
  it('模型阶段只有文件与 completed 自述，没有原生会话仍失败', async () => {
    intent();
    await expect(runRecordedActivity(input, options('spec'), async () => {
      fs.writeFileSync(path.join(worktree, sprint, '02-spec.md'), `---\ntask_id: ${taskId}\nstep: spec\nupstream: [01-intent.md#I-1]\n---\n### S-1\n方案\n`);
      return { status: 'completed', outputs: { spec_file: '02-spec.md' } };
    })).rejects.toThrow(/provenance/);
  });
  it('从真实子进程管道封存原生执行，随后改写公开日志不能替换原始字节', async () => {
    intent();
    const report = path.join(worktree, sprint, '02-spec.md');
    const fake = path.join(temp, 'codex-fixture.mjs');
    const transcript = path.join(temp, 'mutable-transcript.jsonl');
    const native = [{ type: 'thread.started', thread_id: 'fixture-thread' }, { type: 'item.completed', item: { type: 'agent_message', text: 'actual-pipe-result' } }, { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }].map(row => JSON.stringify(row)).join('\n') + '\n';
    const md = `---\ntask_id: ${taskId}\nstep: spec\nupstream: ["01-intent.md#I-1"]\n---\n### S-1\n方案\n`;
    fs.writeFileSync(fake, `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(report)}, ${JSON.stringify(md)});\nprocess.stdout.write(${JSON.stringify(native)});\n`, { mode: 0o755 });
    {
      await runRecordedActivity(input, options('spec'), async () => {
        const run = await runClaude({ args: ['-p', 'fixture'], cwd: worktree, timeoutMs: 5000,
          tag: 'spec', provider: 'codex', transcriptPath: transcript,
          codexEnv: { CODING_WF_CODEX_BIN: fake, CODING_WF_CODEX_MODEL: 'gpt-6-sol' } });
        expect(run.code).toBe(0);
        fs.writeFileSync(transcript, 'forged-mutable-log');
        return { status: 'completed', outputs: { spec_file: '02-spec.md' } };
      });
      const saved = fs.readdirSync(root, { recursive: true }).flatMap(rel => {
        const full = path.join(root, rel);
        return fs.statSync(full).isFile() ? [fs.readFileSync(full, 'utf8')] : [];
      }).join('\n');
      expect(saved).toContain('actual-pipe-result');
      expect(saved).not.toContain('forged-mutable-log');
    }
  });
  it('JSON 输入不能替换受保护根或指定成功凭证', async () => {
    const fakeRoot = path.join(temp, 'model-supplied');
    await runRecordedActivity({ ...input, provenance_root: fakeRoot, provenance: { status: 'PASS' } }, options('intent'), async () => { intent(); return { status: 'completed' }; });
    expect(fs.existsSync(fakeRoot)).toBe(false);
    expect(files().length).toBeGreaterThan(0);
  });
  it.each([[undefined, 1], [-1, 1], ['2', 2]])('evaluate round=%s 的实际文件与凭证统一为 %s', async (round, expected) => {
    await runRecordedActivity({ ...input, round }, options('evaluate'), async current => {
      expect(current.round).toBe(expected);
      fs.writeFileSync(path.join(worktree, sprint, `05-qa-report-r${current.round}.md`),
        `---\ntask_id: ${taskId}\nstep: evaluate\nupstream: []\n---\n# QA\n`);
      captureNativeExecution({ provider: 'codex', code: 0,
        stdout: '{"type":"thread.started","thread_id":"fixture-round"}\n{"type":"turn.completed"}\n' });
      return { status: 'completed' };
    });
    const stage = files().map(f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))).find(e => e.kind === 'stage');
    expect(stage.round).toBe(expected);
    expect(stage.records[0].path).toBe(`${sprint}/05-qa-report-r${expected}.md`);
  });
});
