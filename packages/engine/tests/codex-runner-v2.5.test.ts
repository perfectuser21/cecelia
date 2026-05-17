import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const RUNNER = path.resolve(__dirname, '../runners/codex/runner.sh');

describe('runner.sh v2.5.0 — OAuth 专用模式', () => {
  describe('API Key 注入已删除（v2.1.0 的历史债务）', () => {
    it('不再包含 CODEX_API_KEY 加载逻辑', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      // v2.1.0 引入的 API Key 注入代码块已被删除
      expect(content).not.toContain('加载 API Key');
    });

    it('不再读取 openai.env credentials 文件', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      // 删除对 ~/.credentials/openai.env 的读取
      expect(content).not.toContain('openai.env');
    });

    it('不再向环境注入 CODEX_API_KEY', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      // runner 不应该 export CODEX_API_KEY
      const lines = content.split('\n').filter(l => !l.startsWith('#'));
      const injectsKey = lines.some(l => l.includes('export CODEX_API_KEY='));
      expect(injectsKey).toBe(false);
    });
  });

  describe('版本号', () => {
    it('版本号已更新为 v2.5.0', () => {
      const content = fs.readFileSync(RUNNER, 'utf-8');
      expect(content).toContain('v2.5.0');
    });
  });
});
