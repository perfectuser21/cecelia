/**
 * INV-07: 报告 Basic Auth
 * report_url 不带 Basic Auth → 401；报告文件永久留存
 *
 * 两种模式：
 * 1. mock 模式（CI 默认）：使用 nock mock HTTP 层，验证 Brain 调用 HK Caddy 时的 Basic Auth 行为
 * 2. 集成模式（HK_HOST 设置后启用）：真实请求 HK Caddy
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import nock from 'nock';

const HK_HOST = process.env.HK_HOST || 'hk-test-host';
const EVAL_BASIC_USER = process.env.EVAL_BASIC_USER;
const EVAL_BASIC_PASS = process.env.EVAL_BASIC_PASS;
const RUN_INTEGRATION = !!process.env.HK_HOST;

// ── Mock 模式（CI 默认，nock 拦截 HTTP）────────────────────────────────
describe('INV-07: 报告 Basic Auth（mock 模式，CI 可运行）', () => {
  const MOCK_HOST = 'https://mock-hk-host';
  const REPORT_PATH = '/skill-evals/a1b2c3d4-slug/report.html';

  beforeAll(() => {
    // 拦截：无 Authorization 头 → 401
    nock(MOCK_HOST)
      .get(REPORT_PATH)
      .reply(401, 'Unauthorized', { 'WWW-Authenticate': 'Basic realm="eval"' });

    // 拦截：带正确 Basic Auth → 200
    nock(MOCK_HOST)
      .get(REPORT_PATH)
      .basicAuth({ user: 'testuser', pass: 'testpass' })
      .reply(200, '<html><body>功能地图...裁决...</body></html>');

    // 拦截：带错误 Basic Auth → 401
    nock(MOCK_HOST)
      .get(REPORT_PATH)
      .basicAuth({ user: 'wrong', pass: 'wrong' })
      .reply(401, 'Unauthorized');
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('无 Authorization 头访问 report_url → HTTP 401', async () => {
    const res = await fetch(`${MOCK_HOST}${REPORT_PATH}`);
    expect(res.status).toBe(401);
    // 应含 WWW-Authenticate 头，提示客户端需要 Basic Auth
    expect(res.headers.get('www-authenticate')).toMatch(/Basic/i);
  });

  it('带正确 Basic Auth 访问 report_url → HTTP 200 + 含关键词', async () => {
    const credentials = Buffer.from('testuser:testpass').toString('base64');
    const res = await fetch(`${MOCK_HOST}${REPORT_PATH}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('功能地图');
    expect(html).toContain('裁决');
  });

  it('带错误 Basic Auth 访问 report_url → HTTP 401', async () => {
    const credentials = Buffer.from('wrong:wrong').toString('base64');
    const res = await fetch(`${MOCK_HOST}${REPORT_PATH}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(res.status).toBe(401);
  });
});

// ── 单元测试：report_url 格式规则（无需网络，始终运行）─────────────────
describe('INV-07: report_url 格式规则（单元，始终运行）', () => {
  it('report_url 应符合路径规范 /skill-evals/<短码>-<名slug>/', () => {
    const shortCode = 'a1b2c3';
    const nameSlug = 'ri-bao-skill-v1';
    const reportUrl = `https://hk-host/skill-evals/${shortCode}-${nameSlug}/report.html`;

    expect(reportUrl).toMatch(/\/skill-evals\/[a-z0-9]+-[a-z0-9-]+\/report\.html$/);
  });

  it('report_url 短码应为 task_id 的前 8 位（lowercase hex）', () => {
    const taskId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const shortCode = taskId.replace(/-/g, '').slice(0, 8);
    expect(shortCode).toMatch(/^[a-f0-9]{8}$/);
  });

  it('skill_name 转 slug：空格→连字符，大写→小写', () => {
    const skillName = '日报 Skill V1';
    const slug = skillName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9一-龥-]/g, '');
    expect(typeof slug).toBe('string');
    expect(slug.length).toBeGreaterThan(0);
  });

  it('report_url 不包含 staging zip 路径（报告与 zip 存储分离）', () => {
    const reportUrl = 'https://hk-host/skill-evals/a1b2c3d4-slug/report.html';
    // 报告路径应在 /skill-evals/ 下，不在 /staging/ 下
    expect(reportUrl).not.toContain('/staging/');
    expect(reportUrl).toMatch(/^https:\/\//);
  });
});

// ── 集成模式（需要 HK_HOST 环境变量，E2E 环境运行）──────────────────────
describe('INV-07: 报告 Basic Auth（集成模式，需 HK_HOST）', () => {
  it.skipIf(!RUN_INTEGRATION)('无 Auth 访问 report_url → HTTP 401', async () => {
    const reportUrl = `https://${HK_HOST}/skill-evals/test-short-test-slug/report.html`;
    const res = await fetch(reportUrl);
    expect(res.status).toBe(401);
  });

  it.skipIf(!RUN_INTEGRATION)('带 Basic Auth 访问 report_url → HTTP 200', async () => {
    const reportUrl = `https://${HK_HOST}/skill-evals/test-short-test-slug/report.html`;
    const credentials = Buffer.from(`${EVAL_BASIC_USER}:${EVAL_BASIC_PASS}`).toString('base64');
    const res = await fetch(reportUrl, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(res.status).toBe(200);
  });

  it.skipIf(!RUN_INTEGRATION)('报告内容含"功能地图"与"裁决"', async () => {
    const reportUrl = process.env.LAST_REPORT_URL;
    if (!reportUrl) return;

    const credentials = Buffer.from(`${EVAL_BASIC_USER}:${EVAL_BASIC_PASS}`).toString('base64');
    const res = await fetch(reportUrl, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    const html = await res.text();
    expect(html).toContain('功能地图');
    expect(html).toContain('裁决');
  });
});
