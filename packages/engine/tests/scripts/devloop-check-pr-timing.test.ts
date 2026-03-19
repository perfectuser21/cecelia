import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — PR 时序：审查在 PR 创建之前', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('条件顺序验证', () => {
    it('cto_review（条件 2.5）在 PR 创建（条件 1）之前', () => {
      const reviewPos = content.indexOf('条件 2.5');
      const prPos = content.indexOf('条件 1: PR');
      expect(reviewPos).toBeGreaterThan(-1);
      expect(prPos).toBeGreaterThan(-1);
      expect(reviewPos).toBeLessThan(prPos);
    });

    it('code_quality（条件 2.6）在 PR 创建之前', () => {
      const cqPos = content.indexOf('条件 2.6');
      const prPos = content.indexOf('条件 1: PR');
      expect(cqPos).toBeGreaterThan(-1);
      expect(cqPos).toBeLessThan(prPos);
    });

    it('prd_audit（条件 2.7）在 PR 创建之前', () => {
      const paPos = content.indexOf('条件 2.7');
      const prPos = content.indexOf('条件 1: PR');
      expect(paPos).toBeGreaterThan(-1);
      expect(paPos).toBeLessThan(prPos);
    });

    it('PR 创建（条件 1）在 CI（条件 3）之前', () => {
      const prPos = content.indexOf('条件 1: PR');
      const ciPos = content.indexOf('条件 3: CI');
      expect(prPos).toBeGreaterThan(-1);
      expect(ciPos).toBeGreaterThan(-1);
      expect(prPos).toBeLessThan(ciPos);
    });
  });

  describe('本机 Codex 审查（非西安）', () => {
    it('审查阻塞消息不包含"西安"', () => {
      // 条件 2.5/2.6/2.7 的 blocked 消息应该说"本机 Codex"而不是"西安 Codex"
      const reviewBlocks = content.match(/blocked.*reason.*审查|blocked.*reason.*Review/g) || [];
      for (const block of reviewBlocks) {
        expect(block).not.toContain('西安');
      }
    });

    it('PR Review 消息使用"本机 Codex"', () => {
      expect(content).toContain('本机 Codex PR Review');
    });
  });

  describe('PR 创建消息正确', () => {
    it('PR 未创建时提示"审查已通过"', () => {
      expect(content).toContain('审查已通过，PR 未创建');
    });
  });
});
