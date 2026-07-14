/**
 * WS1 Red Tests — task-router.js + .env BARK_TOKEN
 * 在 WS1 实现前，以下测试必须全部 FAIL。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const TASK_ROUTER_PATH = resolve(process.cwd(), 'packages/brain/src/task-router.js');
const ENV_PATH = resolve(process.cwd(), 'packages/brain/.env');

describe('WS1 — task-router harness_intervention 路由注册 [BEHAVIOR]', () => {
  it('VALID_TASK_TYPES 包含 harness_intervention', () => {
    const src = readFileSync(TASK_ROUTER_PATH, 'utf8');
    // 找到 VALID_TASK_TYPES 数组定义段
    const arrayMatch = src.match(/const VALID_TASK_TYPES\s*=\s*\[([\s\S]*?)\]/);
    expect(arrayMatch, 'VALID_TASK_TYPES 数组未找到').toBeTruthy();
    expect(arrayMatch![0]).toContain("'harness_intervention'");
  });

  it('LOCATION_MAP 显式映射 harness_intervention → us（非 DEFAULT_LOCATION 兜底）', () => {
    const src = readFileSync(TASK_ROUTER_PATH, 'utf8');
    // 找到 LOCATION_MAP 对象定义段
    const mapMatch = src.match(/const LOCATION_MAP\s*=\s*\{([\s\S]*?)\}/);
    expect(mapMatch, 'LOCATION_MAP 对象未找到').toBeTruthy();
    expect(mapMatch![0]).toMatch(/'harness_intervention':\s*'us'/);
  });

  it('.env 文件包含 BARK_TOKEN= 行（非空值）', () => {
    let src: string;
    try {
      src = readFileSync(ENV_PATH, 'utf8');
    } catch {
      throw new Error(`packages/brain/.env 不存在，WS1 需要创建并写入 BARK_TOKEN`);
    }
    const match = src.match(/BARK_TOKEN=(\S+)/);
    expect(match, '.env 中未找到 BARK_TOKEN= 行').toBeTruthy();
    expect(match![1].length, 'BARK_TOKEN 值不能为空').toBeGreaterThan(5);
  });

  it('regression: 现有 dev → us 路由未被破坏', () => {
    const src = readFileSync(TASK_ROUTER_PATH, 'utf8');
    const mapMatch = src.match(/const LOCATION_MAP\s*=\s*\{([\s\S]*?)\}/);
    expect(mapMatch).toBeTruthy();
    expect(mapMatch![0]).toMatch(/'dev':\s*'us'/);
  });
});
