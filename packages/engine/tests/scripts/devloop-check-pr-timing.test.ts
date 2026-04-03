import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 4-Stage Pipeline 条件顺序', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('PR 创建消息正确', () => {
    it('PR 未创建时提示创建 PR', () => {
      expect(content).toContain('PR 未创建');
    });
  });
});
