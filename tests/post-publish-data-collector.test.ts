/**
 * 发布后数据回收 — post-publish-data-collector 静态验证
 *
 * 验证策略：静态代码结构检查（不依赖 DB/服务）
 *   - 新模块 post-publish-data-collector.js 存在且导出核心函数
 *   - migration SQL 文件存在且包含 pipeline_publish_stats 表定义
 *   - content-pipeline.js 路由包含 /stats 端点
 *   - tick.js 中集成了 collectPostPublishData 调用
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRAIN_SRC = resolve(__dirname, '../packages/brain/src');
const MIGRATIONS_DIR = resolve(__dirname, '../packages/brain/migrations');

describe('post-publish-data-collector 模块存在', () => {
  it('post-publish-data-collector.js 存在', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'post-publish-data-collector.js'), 'utf-8');
    expect(content).toBeTruthy();
  });

  it('导出 collectPostPublishData 函数', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'post-publish-data-collector.js'), 'utf-8');
    expect(content).toContain('export async function collectPostPublishData');
  });

  it('包含 4h 延迟阈值常量或逻辑', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'post-publish-data-collector.js'), 'utf-8');
    // 4 * 60 * 60 * 1000 = 14400000ms 或直接写 4 * 60
    expect(content).toMatch(/4\s*\*\s*60|4\s*hours?|4h|14400|COLLECT_DELAY/i);
  });

  it('包含 pipeline_publish_stats 写入逻辑', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'post-publish-data-collector.js'), 'utf-8');
    expect(content).toContain('pipeline_publish_stats');
  });
});

describe('pipeline_publish_stats 迁移文件', () => {
  it('migration 文件存在', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    const migrationFile = files.find(f => f.includes('pipeline_publish_stats'));
    expect(migrationFile).toBeTruthy();
  });

  it('migration SQL 包含必要字段', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    const migrationFile = files.find(f => f.includes('pipeline_publish_stats'));
    expect(migrationFile).toBeTruthy();

    const content = readFileSync(resolve(MIGRATIONS_DIR, migrationFile!), 'utf-8');
    expect(content).toContain('pipeline_publish_stats');
    expect(content).toContain('platform');
    expect(content).toContain('pipeline_id');
    expect(content).toContain('publish_task_id');
    expect(content).toContain('views');
    expect(content).toContain('likes');
    expect(content).toContain('scraped_at');
  });
});

describe('/api/brain/pipelines/:id/stats 路由', () => {
  it('content-pipeline.js 包含 /stats 路由', () => {
    const content = readFileSync(
      resolve(BRAIN_SRC, 'routes/content-pipeline.js'),
      'utf-8'
    );
    expect(content).toContain('/stats');
  });

  it('/stats 路由查询 pipeline_publish_stats 表', () => {
    const content = readFileSync(
      resolve(BRAIN_SRC, 'routes/content-pipeline.js'),
      'utf-8'
    );
    expect(content).toContain('pipeline_publish_stats');
  });
});

describe('tick.js 集成', () => {
  it('tick.js 导入 post-publish-data-collector', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'tick.js'), 'utf-8');
    expect(content).toContain('post-publish-data-collector');
  });

  it('tick.js 调用 collectPostPublishData', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'tick.js'), 'utf-8');
    expect(content).toContain('collectPostPublishData');
  });
});

describe('[PRESERVE] 现有 monitorPublishQueue 不变', () => {
  it('publish-monitor.js 仍导出 monitorPublishQueue', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'publish-monitor.js'), 'utf-8');
    expect(content).toContain('export async function monitorPublishQueue');
  });

  it('publish-monitor.js 仍导出 getPublishStats', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'publish-monitor.js'), 'utf-8');
    expect(content).toContain('export async function getPublishStats');
  });
});

describe('[PRESERVE] 现有 pipeline API 端点不变', () => {
  it('/stages 端点仍存在', () => {
    const content = readFileSync(
      resolve(BRAIN_SRC, 'routes/content-pipeline.js'),
      'utf-8'
    );
    expect(content).toContain('/stages');
  });

  it('/output 端点仍存在', () => {
    const content = readFileSync(
      resolve(BRAIN_SRC, 'routes/content-pipeline.js'),
      'utf-8'
    );
    expect(content).toContain('/output');
  });
});
