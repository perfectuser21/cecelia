/**
 * WS1 TDD Red Phase — GET /initiative/:id/detail 路由
 *
 * 路由尚未在 harness.js 中注册，以下所有 test 应 FAIL（Red）
 * Generator 实现后变 Green
 *
 * PRD 字段: initiative_id, prd_content, contract_content, gan_rounds, step_timing, screenshot_urls
 * 禁用字段: prd, contract, timeline, screenshots, stages, details, data
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '../../../');
const HARNESS_ROUTE_FILE = join(REPO_ROOT, 'packages/brain/src/routes/harness.js');

describe('WS1 — GET /initiative/:id/detail 路由注册 [BEHAVIOR]', () => {
  it('harness.js 含 router.get("/initiative/:id/detail" 路由注册', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    expect(content).toContain("router.get('/initiative/:id/detail'");
  });

  it('路由处理函数查询 tasks 表（含 task_type = harness_initiative 过滤）', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    expect(content).toMatch(/harness_initiative/);
    expect(content).toMatch(/task_type/);
  });

  it('路由响应含 initiative_id 字段（PRD 必填）', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    expect(content).toMatch(/initiative_id/);
  });

  it('路由响应含 prd_content 字段（PRD 必填，禁止改名为 prd）', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    expect(content).toMatch(/prd_content/);
    // 确保没有用禁用字段名 prd 作为 response key（这一行在 detail 实现后也要过）
    const detailRouteMatch = content.match(/router\.get\('\/initiative\/:id\/detail'[\s\S]*?^}\);/m);
    // 如果路由存在，检查 prd 字段名不作为 response key 出现（只允许 prd_content）
    if (detailRouteMatch) {
      const routeBody = detailRouteMatch[0];
      // 不应直接 res.json({ prd: ... }) — 应该是 prd_content
      expect(routeBody).not.toMatch(/['"](prd|timeline|screenshots|stages|details)['"]\s*:/);
    }
  });

  it('路由响应含 contract_content 字段（PRD 必填，禁止改名为 contract）', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    expect(content).toMatch(/contract_content/);
  });

  it('路由响应含 step_timing 字段（PRD 必填，禁止改名为 timeline/stages）', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    expect(content).toMatch(/step_timing/);
  });

  it('路由响应含 screenshot_urls 字段（PRD 必填，禁止改名为 screenshots）', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    expect(content).toMatch(/screenshot_urls/);
  });

  it('route 返回 404 + error 字段 when initiative not found（含 initiative not found 错误文字）', () => {
    const content = readFileSync(HARNESS_ROUTE_FILE, 'utf-8');
    // 路由内应包含 initiative not found 错误响应
    expect(content).toMatch(/initiative not found/);
  });
});
