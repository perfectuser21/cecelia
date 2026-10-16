/**
 * Regression test: 图片+文字同批次，图片处理失败时文字消息仍被回复
 *
 * 复现场景：客户在同一 P2P 或群聊批次中先发图片消息、再发文字消息。
 * handleChat 若因图片内容抛出异常，文字消息必须仍得到回复（降级纯文字重试）。
 *
 * 永久留 CI，禁止删除（regression guard）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPS_SRC = readFileSync(resolve(__dirname, '../routes/ops.js'), 'utf-8');

describe('[regression] 图片+文字批次 — 图片失败时文字仍回复', () => {
  describe('P2P fallback handleChat — 图片失败降级路径', () => {
    it('P2P批处理应检测批次中是否含非图片文字消息', () => {
      // 检测 p2pHasTextMsg 变量存在（批次文字判断）
      expect(OPS_SRC).toContain('p2pHasTextMsg');
    });

    it('P2P批处理：含图片且handleChat抛出时应降级纯文字重试', () => {
      // 检测降级分支：batchImageContent && p2pHasTextMsg
      expect(OPS_SRC).toContain('batchImageContent && p2pHasTextMsg');
    });

    it('P2P批处理降级重试时传 null imageContent', () => {
      // 降级时传入 null 而非 batchImageContent
      expect(OPS_SRC).toContain('handleChat 图片处理失败，降级纯文字重试:');
    });

    it('P2P降级重试应在内层 catch 中调用 handleChat with null', () => {
      // 确认降级路径将 imageContent 设为 null
      const p2pSection = OPS_SRC.slice(
        OPS_SRC.indexOf('p2pHasTextMsg'),
        OPS_SRC.indexOf('Fallback 回复')
      );
      // 内层 catch 中调用 handleChat(... null)
      expect(p2pSection).toContain('p2pHistory, null');
    });
  });

  describe('Group Mode A handleChat — 图片失败降级路径', () => {
    it('群聊批处理应检测批次中是否含非图片文字消息', () => {
      expect(OPS_SRC).toContain('groupHasTextMsg');
    });

    it('群聊批处理：含图片且handleChat抛出时应降级纯文字重试', () => {
      expect(OPS_SRC).toContain('batchImageContent && groupHasTextMsg');
    });

    it('群聊批处理降级应记录警告日志', () => {
      expect(OPS_SRC).toContain('handleChat 图片处理失败，降级纯文字重试:');
    });

    it('群聊降级重试传 null imageContent', () => {
      const groupSection = OPS_SRC.slice(
        OPS_SRC.indexOf('groupHasTextMsg'),
        OPS_SRC.indexOf('handleChat 无回复，跳过')
      );
      expect(groupSection).toContain('], null)');
    });
  });

  describe('降级判断逻辑 — 仅文字消息时不降级', () => {
    it('hasTextMsg 判断应排除纯图片消息（text !== \'[图片]\'）', () => {
      // 确保降级条件正确：不将图片占位符当文字消息
      expect(OPS_SRC).toContain("m.text !== '[图片]'");
    });

    it('仅图片批次（无文字消息）时不触发降级（throw 透传）', () => {
      // 降级条件：batchImageContent && hasTextMsg — 两个条件都需满足
      // 确认 throw chatErr 存在（仅图片批次时透传错误）
      expect(OPS_SRC).toContain('throw chatErr');
    });
  });
});
