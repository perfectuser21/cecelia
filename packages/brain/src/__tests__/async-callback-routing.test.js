/**
 * 测试：P2P 回调路由表化
 * 验证 ASYNC_CALLBACK_TYPES 从 task-router.js 驱动，ops.js 不再 hardcode
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ASYNC_CALLBACK_TYPES } from '../task-router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..');

describe('ASYNC_CALLBACK_TYPES 路由表', () => {
  it('ASYNC_CALLBACK_TYPES 是 Set 类型', () => {
    expect(ASYNC_CALLBACK_TYPES).toBeInstanceOf(Set);
  });

  it('包含 explore（信息探查）', () => {
    expect(ASYNC_CALLBACK_TYPES.has('explore')).toBe(true);
  });

  it('包含 research（深度调研）', () => {
    expect(ASYNC_CALLBACK_TYPES.has('research')).toBe(true);
  });

  it('不包含非异步类型（如 dev、talk）', () => {
    expect(ASYNC_CALLBACK_TYPES.has('dev')).toBe(false);
    expect(ASYNC_CALLBACK_TYPES.has('talk')).toBe(false);
  });
});

describe('ops.js 使用路由表而非 hardcode', () => {
  const opsContent = readFileSync(resolve(SRC, 'routes/ops.js'), 'utf-8');

  it('import 了 ASYNC_CALLBACK_TYPES', () => {
    expect(opsContent).toContain('ASYNC_CALLBACK_TYPES');
  });

  it('使用 ASYNC_CALLBACK_TYPES.has() 判断', () => {
    expect(opsContent).toContain('ASYNC_CALLBACK_TYPES.has(');
  });

  it("不再 hardcode task_type === 'explore'", () => {
    expect(opsContent).not.toContain("task_type === 'explore'");
  });
});
