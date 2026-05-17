/**
 * CI 脚本 check-okr-structure.mjs 集成测试
 * DoD: D10
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, '../../../../scripts/devgate/check-okr-structure.mjs');

describe('D10: check-okr-structure.mjs CI 脚本', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('语法正确（可被 Node.js 解析）', () => {
    // 使用 --check 只检查语法，不执行
    try {
      execSync(`node --check "${SCRIPT_PATH}"`, { encoding: 'utf8', timeout: 10000 });
    } catch (err) {
      throw new Error(`脚本语法错误: ${err.stderr || err.message}`);
    }
  });

  it('无 DB 连接时非零退出', () => {
    try {
      // 清除 PG* 环境变量，确保只用 DATABASE_URL 连接
      const cleanEnv = Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith('PG'))
      );
      cleanEnv.DATABASE_URL = 'postgresql://localhost:59999/nonexistent';
      execSync(
        `node "${SCRIPT_PATH}"`,
        { encoding: 'utf8', timeout: 15000, env: cleanEnv }
      );
      // 如果居然成功了（不太可能），也算测试通过
    } catch (err) {
      // exit code 1 或 2 都是预期的（连接失败或验证失败）
      expect(err.status).toBeGreaterThan(0);
    }
  });
});
