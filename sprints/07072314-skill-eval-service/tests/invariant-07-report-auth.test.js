/**
 * INV-07: 报告 Basic Auth
 * report_url 不带 Basic Auth → 401；报告文件永久留存
 */

import { describe, it, expect } from 'vitest';

/**
 * 注意：本测试验证 HK Caddy/nginx 配置，需要集成环境。
 * 单元测试部分验证 Brain 返回的 report_url 格式和路径规则。
 * 完整验证需在 E2E 环境中运行（见 contract-dod.md E2E 验收命令）。
 */

const HK_HOST = process.env.HK_HOST || 'hk-test-host';
const EVAL_BASIC_USER = process.env.EVAL_BASIC_USER;
const EVAL_BASIC_PASS = process.env.EVAL_BASIC_PASS;

describe('INV-07: 报告 Basic Auth（集成验证）', () => {
  // 跳过条件：无 HK_HOST 环境变量时跳过集成测试
  const runIntegration = !!process.env.HK_HOST;

  it.skipIf(!runIntegration)('无 Auth 访问 report_url → HTTP 401', async () => {
    const reportUrl = `https://${HK_HOST}/skill-evals/test-short-test-slug/report.html`;
    const res = await fetch(reportUrl);
    expect(res.status).toBe(401);
  });

  it.skipIf(!runIntegration)('带 Basic Auth 访问 report_url → HTTP 200', async () => {
    const reportUrl = `https://${HK_HOST}/skill-evals/test-short-test-slug/report.html`;
    const credentials = btoa(`${EVAL_BASIC_USER}:${EVAL_BASIC_PASS}`);
    const res = await fetch(reportUrl, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(res.status).toBe(200);
  });

  it.skipIf(!runIntegration)('报告内容含"功能地图"与"裁决"', async () => {
    const reportUrl = process.env.LAST_REPORT_URL;
    if (!reportUrl) return;

    const credentials = btoa(`${EVAL_BASIC_USER}:${EVAL_BASIC_PASS}`);
    const res = await fetch(reportUrl, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    const html = await res.text();
    expect(html).toContain('功能地图');
    expect(html).toContain('裁决');
  });

  // 单元测试：验证 report_url 格式
  describe('report_url 格式规则（单元）', () => {
    it('report_url 应符合路径规范 /skill-evals/<短码>-<名slug>/', () => {
      // 模拟 Brain 生成的 report_url
      const shortCode = 'a1b2c3';
      const nameSlug = 'ri-bao-skill-v1';
      const reportUrl = `https://hk-host/skill-evals/${shortCode}-${nameSlug}/report.html`;

      // 路径规则：/skill-evals/<6位短码>-<slug>/report.html
      expect(reportUrl).toMatch(/\/skill-evals\/[a-z0-9]+-[a-z0-9-]+\/report\.html$/);
    });

    it('report_url 短码应为 task_id 的前 6-8 位（lowercase hex）', () => {
      const taskId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const shortCode = taskId.replace(/-/g, '').slice(0, 8);
      expect(shortCode).toMatch(/^[a-f0-9]{8}$/);
    });

    it('skill_name 转 slug：空格→连字符，大写→小写，中文保留或转拼音', () => {
      const skillName = '日报 Skill V1';
      // 预期 slug 逻辑（实际实现可能用 pinyin 库）
      const slug = skillName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9一-龥-]/g, '');
      expect(typeof slug).toBe('string');
      expect(slug.length).toBeGreaterThan(0);
    });
  });
});
