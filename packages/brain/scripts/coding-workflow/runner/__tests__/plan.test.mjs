// runner 纯函数：候选筛选、命名、超时、回执解读、配置。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pickCandidates, isSwitched, stampOf, taskNames, runTimeoutMs } from '../lib/plan.mjs';
import { summarizeReceipt, readReceipt } from '../lib/receipt.mjs';
import { loadConfig } from '../lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(fs.readFileSync(path.join(HERE, '../../contract.json'), 'utf8'));
const BRANCH_RE = /^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$/;

describe('pickCandidates', () => {
  const SW = { coding_workflow: true, headed_manual: 'true' };
  const t = (id, created, payload, extra = {}) => ({ id, created_at: created, task_type: 'data', claimed_by: null, payload, ...extra });

  it('开关三件套（task_type=data、headed_manual="true"、coding_workflow===true）、未认领、repo 缺省或 cecelia，按创建时间升序', () => {
    const tasks = [
      t('a', '2026-10-08T03:00:00Z', SW),
      t('b', '2026-10-08T01:00:00Z', { ...SW, repo: 'cecelia' }),
      t('c', '2026-10-08T00:00:00Z', { ...SW, coding_workflow: 'true' }),
      t('d', '2026-10-08T00:00:00Z', SW, { claimed_by: 'x' }),
      t('e', '2026-10-08T00:00:00Z', { ...SW, repo: 'zenithjoy' }),
      t('f', '2026-10-08T00:00:00Z', null),
      t('g', '2026-10-08T02:00:00Z', SW),
      t('h', '2026-10-08T00:00:00Z', SW, { task_type: 'dev' }),
      t('i', '2026-10-08T00:00:00Z', { coding_workflow: true }),
      t('j', '2026-10-08T00:00:00Z', { ...SW, headed_manual: true }),
    ];
    expect(pickCandidates(tasks).map((x) => x.id)).toEqual(['b', 'g', 'a']);
  });

  it('isSwitched 只看开关三件套', () => {
    expect(isSwitched({ task_type: 'data', payload: SW })).toBe(true);
    expect(isSwitched({ task_type: 'data', payload: { coding_workflow: true } })).toBe(false);
    expect(isSwitched(null)).toBe(false);
  });

  it('非数组输入返回空数组', () => {
    expect(pickCandidates(null)).toEqual([]);
    expect(pickCandidates({ tasks: 1 })).toEqual([]);
  });
});

describe('taskNames', () => {
  it('分支 cp-<MMDDHHmm>-cw-<task前8>，满足全局 pre-commit 钩子正则；sprint 与 run_tag 同戳', () => {
    const n = taskNames('ABCDEF12-3456-4000-8000-000000000000', new Date('2026-10-07T23:05:00Z'));
    expect(n.short).toBe('abcdef12');
    expect(n.stamp).toBe('10080705');
    expect(n.branch).toBe('cp-10080705-cw-abcdef12');
    expect(n.branch).toMatch(BRANCH_RE);
    expect(n.sprintDir).toBe('sprints/10080705-cw-abcdef12');
    expect(n.runTag).toBe('cw-abcdef12-10080705');
  });
});

describe('stampOf', () => {
  it('固定按上海时区取 MMDDHHmm', () => {
    expect(stampOf(new Date('2026-10-08T10:35:00Z'))).toBe('10081835');
  });

  it('午夜与跨年边界：2026-12-31T16:00:00Z → 01010000（午夜不是 24）', () => {
    expect(stampOf(new Date('2026-12-31T16:00:00Z'))).toBe('01010000');
  });

  it.each(['America/Los_Angeles', 'UTC', 'Asia/Shanghai'])('与运行机器 TZ 无关：TZ=%s 子进程结果一致', (TZ) => {
    const planUrl = pathToFileURL(path.join(HERE, '../lib/plan.mjs')).href;
    const code = `import(${JSON.stringify(planUrl)}).then((m) => console.log(m.stampOf(new Date('2026-10-08T10:35:00Z'))))`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ }, encoding: 'utf8' });
    expect(out.trim()).toBe('10081835');
  });
});

describe('runTimeoutMs', () => {
  it('= Σ(活动 budget × max_attempts) + 10 分钟', () => {
    const expected = contract.activities
      .reduce((s, a) => s + a.budget.max_duration_s * (a.runtime.max_attempts ?? 1), 0) * 1000 + 600000;
    expect(runTimeoutMs(contract)).toBe(expected);
  });

  it('契约缺 activities 时只剩 10 分钟兜底', () => {
    expect(runTimeoutMs({})).toBe(600000);
  });
});

describe('summarizeReceipt', () => {
  it('completed：取 outputs.pr_url', () => {
    expect(summarizeReceipt({ status: 'completed', outputs: { pr_url: 'u' }, activities: [] }))
      .toEqual({ status: 'completed', failed_activity: null, reason_code: null, pr_url: 'u' });
  });

  it('partial：第一个未完成活动与其最后一次尝试的 reason_code（跳过 skipped）', () => {
    const receipt = {
      status: 'partial',
      outputs: {},
      activities: [
        { key: 'intent', status: 'completed', attempts: [] },
        { key: 'x', status: 'skipped', attempts: [] },
        { key: 'spec', status: 'failed', attempts: [{ reason_code: 'claude_failed' }, { reason_code: 'claude_timeout' }] },
        { key: 'report', status: 'failed', attempts: [{ reason_code: 'brain_unavailable' }] },
      ],
    };
    expect(summarizeReceipt(receipt)).toEqual({ status: 'partial', failed_activity: 'spec', reason_code: 'claude_timeout', pr_url: null });
  });

  it('执行器级失败（invalid_contract 等）没有活动：reason_code 取 receipt.reason_code', () => {
    expect(summarizeReceipt({ status: 'failed', reason_code: 'invalid_contract', activities: [] }))
      .toEqual({ status: 'failed', failed_activity: null, reason_code: 'invalid_contract', pr_url: null });
  });

  it('completed 却没有 pr_url → 视为失败 pr_url_missing', () => {
    expect(summarizeReceipt({ status: 'completed', outputs: {}, activities: [] }))
      .toEqual({ status: 'completed', failed_activity: null, reason_code: 'pr_url_missing', pr_url: null });
  });
});

describe('readReceipt', () => {
  it('stdout 是合法回执优先；否则回落到 --receipt 文件里的终态（无 last_event）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-receipt-'));
    try {
      const file = path.join(dir, 'r.json');
      expect(readReceipt('{"status":"completed","outputs":{}}\n', file)).toEqual({ status: 'completed', outputs: {} });
      expect(readReceipt('garbage', file)).toBeNull();
      fs.writeFileSync(file, JSON.stringify({ status: 'running', last_event: { cursor: 3 } }));
      expect(readReceipt('garbage', file)).toBeNull();
      fs.writeFileSync(file, JSON.stringify({ status: 'failed', activities: [] }));
      expect(readReceipt('', file)).toEqual({ status: 'failed', activities: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadConfig', () => {
  it('默认值：本机 Brain、专用 clone、~/.cecelia 锁、automerge 开', () => {
    const c = loadConfig({ HOME: '/h' });
    expect(c.brainUrl).toBe('http://localhost:5221');
    expect(c.repo).toBe('/h/perfect21/cecelia-cw-runner');
    expect(c.worktreeBase).toBe('/h/worktrees/cecelia-cw');
    expect(c.logDir).toBe('/h/.cecelia/coding-workflow-runner');
    expect(c.lockDir).toBe('/h/.cecelia');
    expect(c.executor).toBeNull();
    expect(c.ghBin).toBe('gh');
    expect(c.skipNpmCi).toBe(false);
    expect(c.automerge).toBe(true);
    expect(c.runTimeoutMs).toBeNull();
    expect(c.listLimit).toBe(500);
    expect(c.failedRetentionDays).toBe(7);
    expect(c.logRetentionDays).toBe(30);
    expect(c.claimer).toBe(`coding-workflow-runner@${os.hostname()}`);
  });

  it('环境变量覆盖；BRAIN_URL 去掉尾部斜杠；CODING_WF_AUTOMERGE=0 关闭', () => {
    const c = loadConfig({
      HOME: '/h',
      BRAIN_URL: 'http://b:1/',
      CODING_WF_REPO: '/r',
      CODING_WF_EXECUTOR: '/e.js',
      CODING_WF_SKIP_NPM_CI: '1',
      CODING_WF_AUTOMERGE: '0',
      CODING_WF_RUN_TIMEOUT_MS: '1234',
      CODING_WF_LIST_LIMIT: '7',
      CODING_WF_FAILED_RETENTION_DAYS: '2',
    });
    expect(c.brainUrl).toBe('http://b:1');
    expect(c.repo).toBe('/r');
    expect(c.executor).toBe('/e.js');
    expect(c.skipNpmCi).toBe(true);
    expect(c.automerge).toBe(false);
    expect(c.runTimeoutMs).toBe(1234);
    expect(c.listLimit).toBe(7);
    expect(c.failedRetentionDays).toBe(2);
  });
});

// 跨处一致性：runner 生成的分支必须被 CI 通用 auto-merge 判为 SKIP（合并权只归 runner 合并门）。
// 两处判据各写一份（CI 脚本与 cifix-scan CW_BRANCH_RE），这条用例防止任一边改了另一边没跟（PR #6153 事故）。
describe('runner 分支与 CI auto-merge 判据一致', () => {
  it('taskNames 生成的分支 → should-auto-merge.sh 输出 SKIP', () => {
    const script = path.join(HERE, '../../../../../../.github/workflows/scripts/should-auto-merge.sh');
    for (const id of ['05ae922c-4f2a-4c1c-9f86-d24937fc32d3', 'ABCDEF12-0000-4000-8000-000000000000']) {
      const { branch } = taskNames(id, new Date('2026-10-10T00:39:00+08:00'));
      const out = execFileSync('bash', [script, branch, 'fix(workflow): x'], { encoding: 'utf8' });
      expect(out, branch).toMatch(/^SKIP: coding-workflow-owned/);
    }
  });
});
