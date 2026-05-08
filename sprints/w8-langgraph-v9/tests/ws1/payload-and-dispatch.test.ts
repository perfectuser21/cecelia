import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PAYLOAD_PATH = 'sprints/w8-langgraph-v9/acceptance-task-payload.json';
const TASK_ID_FILE = '/tmp/w8v9-task-id';
const DB = process.env.DB || 'postgresql://localhost/cecelia';

function readPayload(): any {
  if (!existsSync(PAYLOAD_PATH)) throw new Error(`payload not found at ${PAYLOAD_PATH}`);
  return JSON.parse(readFileSync(PAYLOAD_PATH, 'utf8'));
}

function readTaskId(): string {
  if (!existsSync(TASK_ID_FILE)) throw new Error(`${TASK_ID_FILE} not present — Step 1 派发未跑`);
  const id = readFileSync(TASK_ID_FILE, 'utf8').trim();
  if (!id || id === 'null') throw new Error(`task_id 为空或为 "null"`);
  return id;
}

function psql(sql: string): string {
  return execSync(`psql "${DB}" -t -A -c ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
}

function fetchJson(url: string): any {
  const out = execSync(`curl -fsS ${JSON.stringify(url)}`, { encoding: 'utf8' });
  return JSON.parse(out);
}

describe('Workstream 1 — 派发 walking_skeleton + dispatcher 起 graph [BEHAVIOR]', () => {
  it('Brain health 端点返回 healthy/ok（前置：dispatcher 必须在跑才能拉 task）', () => {
    const data = fetchJson('localhost:5221/api/brain/health');
    const status = String(data?.status ?? '').toLowerCase();
    expect(['healthy', 'ok']).toContain(status);
  });

  it('payload 文件存在且 JSON 合法 + 4 项必填 schema 字段全通过', () => {
    const p = readPayload();
    expect(p.task_type).toBe('harness_initiative');
    expect(typeof p?.payload?.walking_skeleton?.thin_feature).toBe('string');
    expect(p.payload.walking_skeleton.thin_feature.length).toBeGreaterThan(0);
    expect(typeof p?.payload?.walking_skeleton?.e2e_acceptance?.command).toBe('string');
    expect(p.payload.walking_skeleton.e2e_acceptance.command.length).toBeGreaterThan(0);
    const t = p?.payload?.walking_skeleton?.e2e_acceptance?.timeout_sec;
    expect(typeof t).toBe('number');
    expect(t).toBeLessThanOrEqual(600);
    expect(t).toBeGreaterThan(0);
  });

  it('POST /api/brain/tasks 返回 task_id（非空、非 "null"），并写入 /tmp/w8v9-task-id', () => {
    const id = readTaskId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{6,}$/);
  });

  it('90s 内 task status 转 in_progress（dispatcher tick 拉到）', () => {
    const id = readTaskId();
    const data = fetchJson(`localhost:5221/api/brain/tasks/${id}`);
    expect(data.status).toBe('in_progress');
  });

  it('5min 时间窗内 task_events 至少 1 条 graph_node_update', () => {
    const id = readTaskId();
    const out = psql(
      `SELECT count(*) FROM task_events WHERE task_id='${id}' AND event_type='graph_node_update' AND created_at > NOW() - interval '5 minutes'`
    );
    expect(parseInt(out, 10)).toBeGreaterThanOrEqual(1);
  });
});
