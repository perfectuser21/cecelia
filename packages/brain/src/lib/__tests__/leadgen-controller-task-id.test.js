import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { buildLeadgenLaunch } from '../leadgen-controller.js';

const taskId = '11111111-2222-4333-8444-555555555555';
const basePlan = {
  task_id: taskId,
  controller_run_id: `wfd-${taskId}`,
  business_tag: `brain${taskId.replaceAll('-', '')}`,
  business_run_id: `douyin_video_discovery-brain${taskId.replaceAll('-', '')}__a1`,
  workflow_key: 'douyin_video_discovery',
  workflow_id: 'b1000000-0000-4000-8000-000000000101',
  machine: 'mmv', profile: 'cloud-phone-test', serial: '47.100.213.173:10001', line: 'jinno',
  company_id: '22222222-2222-4222-8222-222222222222',
  device_instance_id: 'acp-instance', registry: 'cloud-phone-test-profiles.tsv',
  timeout_sec: 2400,
  release_id: '33333333-3333-4333-8333-333333333333',
  observation_id: '44444444-4444-4444-8444-444444444444',
  workflow_definition_version_id: '55555555-5555-4555-8555-555555555555',
  snapshot_sha256: 'a'.repeat(64), source_commit: 'b'.repeat(40),
  env: { LEADGEN_LIMIT: '5', WF_MMV_SSH_ROUTE: 'public', LEADGEN_MMV_DEVICE_RUNTIME: '1',
    DOUYIN_ADB_PORT: '5041', ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5041' },
};

describe('Brain 获客控制器 Task 身份传递', () => {
  it.each(['douyin_video_discovery', 'douyin_video_processing'])('%s 正式子进程得到派发 Task UUID，旧 UUID 不得串入', async workflowKey => {
    const plan = workflowKey === 'douyin_video_discovery' ? basePlan : {
      ...basePlan,
      workflow_key: workflowKey,
      workflow_id: 'b1000000-0000-4000-8000-000000000102',
      business_run_id: `${workflowKey}-${basePlan.business_tag}__a1`,
      env: { ...basePlan.env, LEADGEN_SOURCE_RUN: 'source101' },
    };
    const home = mkdtempSync(join(tmpdir(), 'brain-leadgen-task-id-'));
    try {
      mkdirSync(join(home, 'bin-harvest'));
      writeFileSync(join(home, 'bin-harvest', 'deployment-manifest.json'), JSON.stringify({
        release_id: plan.release_id, observation_id: plan.observation_id, source_commit: plan.source_commit,
      }));
      writeFileSync(join(home, 'bin-harvest', 'leadgen-run.sh'),
        '#!/bin/sh\nprintf "%s|%s\\n" "${WF_BRAIN_TASK_ID:-}" "${BRAIN_TASK_ID:-}" > "$HOME/observed-task-id"\n', { mode: 0o755 });
      // 执行正式构造器生成的同一份 Python 程序，只把远端 HOME 换成隔离 fixture。
      const remote = buildLeadgenLaunch(plan).remote;
      const encoded = remote.match(/[A-Za-z0-9+/=]{1000,}/)?.[0];
      expect(encoded).toBeTruthy();
      const program = `import base64; CORE=base64.b64decode('${encoded}').decode(); exec(CORE)`;
      const launched = spawnSync('python3', ['-c', program, 'launch_business', Buffer.from(JSON.stringify(plan)).toString('base64')], {
        env: { ...process.env, HOME: home, WF_BRAIN_TASK_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          BRAIN_TASK_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        encoding: 'utf8', timeout: 5000,
      });
      expect(launched.status).toBe(0);
      const terminal = join(home, 'brain-runs', `${plan.controller_run_id}.dispatch`, 'terminal.json');
      for (let i = 0; i < 60 && !existsSync(terminal); i++) await delay(50);
      expect(existsSync(terminal)).toBe(true);
      expect(JSON.parse(readFileSync(terminal, 'utf8')).exit_code).toBe(0);
      expect(existsSync(join(home, 'observed-task-id'))).toBe(true);
      expect(readFileSync(join(home, 'observed-task-id'), 'utf8').trim()).toBe(`${taskId}|`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 12000);
});
