import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// 保留真实路由，隔离数据库、调度与警觉状态边界，避免外部副作用。
vi.mock('../../db.js', () => ({
  default: { query: vi.fn(() => { throw new Error('测试禁止访问数据库'); }) }
}));
vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(),
  executeTick: vi.fn(), runTickSafe: vi.fn(), drainTick: vi.fn(),
  getDrainStatus: vi.fn(), cancelDrain: vi.fn(), getStartupErrors: vi.fn(),
  check48hReport: vi.fn()
}));
vi.mock('../../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn(), setManualOverride: vi.fn(),
  clearManualOverride: vi.fn(), evaluateAlertness: vi.fn(),
  ALERTNESS_LEVELS: { CALM: 1 }, LEVEL_NAMES: { 1: 'CALM' },
  getMetrics: vi.fn(), getHistory: vi.fn(), getDiagnosis: vi.fn()
}));
vi.mock('../../alertness/escalation.js', () => ({ getEscalationStatus: vi.fn() }));
vi.mock('../../alertness/healing.js', () => ({ getRecoveryStatus: vi.fn() }));

import router from '../tick.js';
import { getCurrentAlertness, getMetrics, getHistory, getDiagnosis } from '../../alertness/index.js';
import { getEscalationStatus } from '../../alertness/escalation.js';
import { getRecoveryStatus } from '../../alertness/healing.js';
import { getTickStatus, runTickSafe, getStartupErrors } from '../../tick.js';

const app = express();
app.use(express.json());
app.use('/api/brain', router);

beforeEach(() => {
  vi.resetAllMocks();
  getCurrentAlertness.mockReturnValue({
    level: 1, levelName: 'CALM', startedAt: '2026-11-03T12:00:00.000Z',
    reason: 'healthy', duration: 1000, isRecovering: false,
    lastEvaluation: null, override: null
  });
});

const cases = [
  {
    name: 'metrics', dependency: getMetrics,
    value: { cpu: { value: 23, status: 'normal' } },
    body: { success: true, alertness: 'CALM', metrics: { cpu: { value: 23, status: 'normal' } } },
    error: 'Failed to get metrics'
  },
  {
    name: 'history', dependency: getHistory,
    value: [{ timestamp: '2026-11-03T12:00:00.000Z', metric_type: 'cpu', metric_value: 23, threshold_status: 'normal', alertness_level: 1 }],
    body: { success: true, minutes: 60, count: 1, history: [{ timestamp: '2026-11-03T12:00:00.000Z', metric_type: 'cpu', metric_value: 23, threshold_status: 'normal', alertness_level: 1 }] },
    error: 'Failed to get history'
  },
  {
    name: 'diagnosis', dependency: getDiagnosis,
    value: { issues: ['memory pressure'], severity: 'warning', summary: 'Inspect memory' },
    body: { success: true, diagnosis: { issues: ['memory pressure'], severity: 'warning', summary: 'Inspect memory' } },
    error: 'Failed to get diagnosis'
  },
  {
    name: 'escalation', dependency: getEscalationStatus,
    value: { level: 1, isActive: true, startedAt: '2026-11-03T12:00:00.000Z', triggeredBy: 'memory', actionsExecuted: 2, duration: 1000 },
    body: { success: true, escalation: { level: 1, isActive: true, startedAt: '2026-11-03T12:00:00.000Z', triggeredBy: 'memory', actionsExecuted: 2, duration: 1000 } },
    error: 'Failed to get escalation status'
  },
  {
    name: 'healing', dependency: getRecoveryStatus,
    value: { isRecovering: true, phase: 1, phaseName: '验证', capacity: 0.5, duration: 1000, strategiesApplied: 2, actionsExecuted: 3 },
    body: { success: true, healing: { isRecovering: true, phase: 1, phaseName: '验证', capacity: 0.5, duration: 1000, strategiesApplied: 2, actionsExecuted: 3 } },
    error: 'Failed to get healing status'
  }
];

describe('真实 alertness HTTP 路由', () => {
  it.each(cases)('$name 成功读取时返回完整 200 响应', async ({ name, dependency, value, body }) => {
    dependency.mockReturnValue(value);
    const response = await request(app).get(`/api/brain/alertness/${name}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual(body);
    if (name === 'history') {
      expect(getHistory).toHaveBeenCalledTimes(1);
      expect(getHistory).toHaveBeenCalledWith(60);
    }
  });

  it('history 将 minutes 查询参数转换为数值并返回空历史', async () => {
    getHistory.mockResolvedValue([]);
    const response = await request(app).get('/api/brain/alertness/history?minutes=15');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({ success: true, minutes: 15, count: 0, history: [] });
    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(getHistory).toHaveBeenCalledWith(15);
  });

  it.each([null, undefined])('diagnosis 为 %s 时返回明确的缺省诊断', async (value) => {
    getDiagnosis.mockReturnValue(value);
    const response = await request(app).get('/api/brain/alertness/diagnosis');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual({
      success: true,
      diagnosis: { issues: [], severity: 'none', summary: 'No diagnosis available' }
    });
  });

  it.each(cases)('$name 依赖失败时返回精确的 500 错误', async ({ name, dependency, error }) => {
    if (name === 'metrics' || name === 'history') dependency.mockRejectedValue(new Error('依赖不可用'));
    else dependency.mockImplementation(() => { throw new Error('依赖不可用'); });
    const response = await request(app).get(`/api/brain/alertness/${name}`);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error, details: '依赖不可用' });
  });
});

describe('相邻 tick HTTP 路由', () => {
  it('手动触发 tick 返回执行结果', async () => {
    runTickSafe.mockResolvedValue({ success: true, dispatched: 0, reason: 'idle' });
    const response = await request(app).post('/api/brain/tick');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, dispatched: 0, reason: 'idle' });
    expect(runTickSafe).toHaveBeenCalledTimes(1);
    expect(runTickSafe).toHaveBeenCalledWith('manual');
  });

  it('读取 tick 状态返回完整响应', async () => {
    getTickStatus.mockResolvedValue({ enabled: true, startup_ok: true, tick_count: 7 });
    const response = await request(app).get('/api/brain/tick/status');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: true, startup_ok: true, tick_count: 7 });
  });

  it('读取启动诊断返回错误历史', async () => {
    getStartupErrors.mockResolvedValue({ errors: [], total_failures: 0, last_error_at: null });
    const response = await request(app).get('/api/brain/tick/startup-errors');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ errors: [], total_failures: 0, last_error_at: null });
  });
});
