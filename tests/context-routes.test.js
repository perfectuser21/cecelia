/**
 * context-routes.test.js
 * 验证 /api/brain/context + /api/brain/okr/current + /api/brain/consolidate 路由结构
 *
 * 纯静态结构验证（不依赖 DB），确保路由文件格式正确、导出符合预期。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const contextRoutePath = path.join(projectRoot, 'packages/brain/src/routes/context.js');
const routesIndexPath = path.join(projectRoot, 'packages/brain/src/routes.js');

describe('context-routes: 文件结构验证', () => {
  it('context.js 存在', () => {
    expect(fs.existsSync(contextRoutePath)).toBe(true);
  });

  it('context.js 包含 /context 路由', () => {
    const content = fs.readFileSync(contextRoutePath, 'utf8');
    expect(content).toContain("'/context'");
  });

  it('context.js 包含 /okr/current 路由', () => {
    const content = fs.readFileSync(contextRoutePath, 'utf8');
    expect(content).toContain("'/okr/current'");
  });

  it('context.js 包含 POST /consolidate 路由', () => {
    const content = fs.readFileSync(contextRoutePath, 'utf8');
    expect(content).toContain("'/consolidate'");
  });

  it('context.js 导入 runConversationConsolidator', () => {
    const content = fs.readFileSync(contextRoutePath, 'utf8');
    expect(content).toContain('runConversationConsolidator');
  });

  it('routes.js 已注册 contextRouter', () => {
    const content = fs.readFileSync(routesIndexPath, 'utf8');
    expect(content).toContain('contextRouter');
    expect(content).toContain("'./routes/context.js'");
  });

  it('routes.js 的 router.stack.push 机制完整', () => {
    const content = fs.readFileSync(routesIndexPath, 'utf8');
    expect(content).toContain('router.stack.push');
    expect(content).toContain('contextRouter');
  });
});
