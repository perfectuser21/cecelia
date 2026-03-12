/**
 * Learning Quality Scorer Tests
 *
 * 测试 scoreLearning 纯函数对各类内容的评分规则。
 */

import { describe, it, expect } from 'vitest';
import { scoreLearning } from '../learning-quality-scorer.js';

describe('scoreLearning', () => {
  // ── 空壳样本：得分应 < 40 ──────────────────────────────────────────────
  describe('空壳样本 (score < 40)', () => {
    it('空字符串得 0 分', () => {
      const result = scoreLearning('');
      expect(result.score).toBe(0);
      expect(result.source_type).toBe('empty_shell');
    });

    it('null 得 0 分', () => {
      const result = scoreLearning(null);
      expect(result.score).toBe(0);
      expect(result.source_type).toBe('empty_shell');
    });

    it('纯空壳词 "test ok pass" 得分 < 40', () => {
      const result = scoreLearning('test ok pass');
      expect(result.score).toBeLessThan(40);
      expect(result.source_type).toBe('empty_shell');
    });

    it('"completed successfully" 短文本得分 < 40', () => {
      const result = scoreLearning('completed successfully');
      expect(result.score).toBeLessThan(40);
      expect(result.source_type).toBe('empty_shell');
    });

    it('"done" 单词得分 < 40', () => {
      const result = scoreLearning('done');
      expect(result.score).toBeLessThan(40);
      expect(result.source_type).toBe('empty_shell');
    });

    it('"LGTM works fixed" 得分 < 40', () => {
      const result = scoreLearning('LGTM works fixed');
      expect(result.score).toBeLessThan(40);
      expect(result.source_type).toBe('empty_shell');
    });

    it('长度不足 20 字的无意义内容得分 < 40', () => {
      const result = scoreLearning('ok fine');
      expect(result.score).toBeLessThan(40);
    });
  });

  // ── 真实 Learning 样本：得分应 >= 60 ──────────────────────────────────
  describe('真实 learning 样本 (score >= 60)', () => {
    it('含根因 + 改进点的中文 learning 得分 >= 60', () => {
      const content = '根因：并发任务过多导致内存超限。改进：限制最大并发为 10，添加内存阈值监控，避免 OOM 崩溃。';
      const result = scoreLearning(content);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('含英文 root cause + solution 的 learning 得分 >= 60', () => {
      const content = 'The login function fails because of a null pointer exception. Solution: add null check before accessing user.id. Should be fixed in auth-middleware.';
      const result = scoreLearning(content);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('含 "because" + "should" 的 learning 得分 >= 60', () => {
      const content = 'The scheduler deadlocks because two tasks hold circular locks. We should implement lock ordering to prevent this pattern.';
      const result = scoreLearning(content);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('含 "导致" + "需要" 的中文 learning 得分 >= 60', () => {
      const content = 'CI 失败导致 3 次重试浪费资源，需要在 lint 阶段提前检测语法错误，减少无效构建次数。';
      const result = scoreLearning(content);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });
  });

  // ── 规则分支：各单独规则的扣分行为 ────────────────────────────────────
  describe('规则分支覆盖', () => {
    it('长度 < 20：大幅扣分', () => {
      // 仅长度不足，无其他扣分：100 - 60(length) = 40，但也会扣无根因(-20)、无改进(-15) → 5
      const result = scoreLearning('short text');
      expect(result.score).toBeLessThan(40);
    });

    it('长度 20-49：轻微扣分', () => {
      // 长度 25 字，含根因含改进：100 - 20(length) = 80
      const content = 'because issue, we should fix this now.';
      const result = scoreLearning(content);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('无根因标记：扣 20 分', () => {
      // 长文本 + 无根因 + 有改进 → 100 - 20(no-root-cause) = 80，但无根因扣20
      const longContentNoRootCause = 'This is a learning note about improving the caching layer. We should increase TTL and add retry logic for better stability.';
      const result = scoreLearning(longContentNoRootCause);
      // 有改进但无根因，扣 20
      expect(result.score).toBeLessThanOrEqual(80);
    });

    it('无改进点：扣 15 分', () => {
      const longContentNoImprovement = 'The system crashed because of a memory leak in the event loop. This happened on 2026-03-12 at 14:00.';
      const result = scoreLearning(longContentNoImprovement);
      // 有根因无改进，扣 15
      expect(result.score).toBeLessThanOrEqual(85);
    });

    it('含模板套话：扣 15 分', () => {
      // 长文本（无长度扣分）+ 含 TODO/示例 + 无根因 + 无改进 → 100-15-20-15=50
      const templateContent = 'This is a placeholder example here for future improvements to be filled in later by the team.';
      const result = scoreLearning(templateContent);
      expect(result.score).toBeLessThan(60);
    });

    it('空壳词在长文本中不扣分', () => {
      // 超过 120 字的长文本中提及 "test"，不应触发空壳扣分
      const longText = 'During the load test, we discovered that the database connection pool was because of exhaustion under high concurrency. The root cause is that each request creates a new connection. We should implement connection pooling and fix the retry logic to avoid this issue in the future.';
      const result = scoreLearning(longText);
      expect(result.score).toBeGreaterThanOrEqual(60);
    });
  });

  // ── source_type 分类 ──────────────────────────────────────────────────
  describe('source_type 分类', () => {
    it('score < 40 → empty_shell', () => {
      const result = scoreLearning('ok pass');
      expect(result.source_type).toBe('empty_shell');
    });

    it('score 40-59 → minimal', () => {
      // 构造刚好落在 minimal 区间的内容：长度 >= 50，无根因，无改进，无空壳词
      // 100 - 20(no-root) - 15(no-improvement) = 65... 需要再加一些扣分
      // 长度 20-49: 100 - 20(length) - 20(no-root) - 15(no-improvement) = 45
      const content = 'The system had an issue and some things broke here.';
      const result = scoreLearning(content);
      // 无根因无改进，扣 20+15=35；长度 50 字刚好不扣长度；结果 65 → standard
      // 用更短内容确保落到 minimal
      const shortContent = 'Something went wrong somewhere today.';
      const r2 = scoreLearning(shortContent);
      expect(r2.score).toBeGreaterThanOrEqual(40);
      expect(r2.score).toBeLessThan(60);
      expect(r2.source_type).toBe('minimal');
    });

    it('score 60-79 → standard', () => {
      // 长度 20-49（-20）+ 含根因（无扣）+ 含改进（无扣）→ 100-20=80，但需要在 60-79
      // 长度 20-49 + 根因 + 改进 → 80，刚好是 rich。改用：长度 >= 50 + 无根因 + 有改进
      // 100 - 20(no-root) = 80... 那就加上：无根因(-20) → 80 → rich
      // 需要: 100 - 20(no-root) - 15(template or 其他) = 65 → standard
      // 长文本 + 无根因 + 有改进 + 有模板 → 100 - 20 - 15 = 65
      const content = 'TODO: The system should implement retry logic and backoff strategy for all external API calls here.';
      const result = scoreLearning(content);
      expect(result.score).toBeGreaterThanOrEqual(60);
      expect(result.score).toBeLessThan(80);
      expect(result.source_type).toBe('standard');
    });

    it('score >= 80 → rich', () => {
      const content = '根因：任务队列积压导致内存溢出，触发 OOM Killer。改进措施：需要在 dispatcher 中添加反压机制，限制最大队列深度，并在内存超过 80% 时暂停派发新任务。';
      const result = scoreLearning(content);
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.source_type).toBe('rich');
    });
  });

  // ── 返回值结构 ────────────────────────────────────────────────────────
  describe('返回值结构', () => {
    it('返回包含 score 和 source_type 的对象', () => {
      const result = scoreLearning('test content');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('source_type');
    });

    it('score 始终在 0-100 范围内', () => {
      const inputs = ['', 'ok', 'test pass done completed success', '根因：XXX 导致 YYY。改进：需要修复。'];
      for (const input of inputs) {
        const { score } = scoreLearning(input);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });
  });
});
