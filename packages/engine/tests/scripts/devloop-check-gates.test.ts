import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');
describe('devloop-check.sh — 4-Stage Pipeline 门禁条件（subagent 架构）', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  describe('spec_review / code_review_gate 改为 Agent subagent（旧 Codex 路径已删除）', () => {
    it('不再包含 spec_review_task_id（已删除 Codex async 路径）', () => {
      expect(content).not.toContain('spec_review_task_id');
    });

    it('不再包含 _check_codex_review 函数（已删除）', () => {
      expect(content).not.toContain('_check_codex_review');
    });

    it('不再包含 code_review_gate_task_id（已删除 Codex async 路径）', () => {
      expect(content).not.toContain('code_review_gate_task_id');
    });

  });

  describe('与现有机制兼容', () => {
    it('保留 cleanup_done 终止条件', () => {
      expect(content).toContain('cleanup_done: true');
    });

    it('兼容旧字段名 step_4_learning', () => {
      expect(content).toContain('step_4_learning');
    });
  });


  describe('单一出口原则：ready_to_merge 已删除', () => {
    it('不再包含 status:ready_to_merge（已改为直接自动合并）', () => {
      // 注释里可能提到该词，精确匹配 JSON status 字段值
      expect(content).not.toContain('"ready_to_merge"');
    });

    it('CI in_progress 路径不输出 action 字段', () => {
      // stop-dev.sh 遇到 action 字段会附加 "⚠️ 立即执行"，CI 进行中无需 Claude 执行任何操作
      const ciInProgressIdx = content.indexOf('CI 进行中');
      expect(ciInProgressIdx).toBeGreaterThan(-1);
      const lineStart = content.lastIndexOf('\n', ciInProgressIdx);
      const lineEnd = content.indexOf('\n', ciInProgressIdx);
      const line = content.substring(lineStart, lineEnd);
      expect(line).not.toContain('"action"');
    });

    it('条件 6 路径包含自动合并命令', () => {
      const cond6Idx = content.indexOf('条件 6');
      expect(cond6Idx).toBeGreaterThan(-1);
      // 条件 6 到 merge 命令距离较长（含合并前检查），搜索 1500 字符
      const section = content.substring(cond6Idx, cond6Idx + 1500);
      expect(section).toContain('gh pr merge');
      expect(section).toContain('--squash');
    });

    it('合并成功后返回 status:done', () => {
      // "已自动合并" 出现在 reason 字段中，status:"done" 在它之前的同一 JSON 行
      const mergeSuccessIdx = content.indexOf('已自动合并');
      expect(mergeSuccessIdx).toBeGreaterThan(-1);
      // 向前搜索 200 字符找 status:done
      const section = content.substring(mergeSuccessIdx - 200, mergeSuccessIdx + 50);
      expect(section).toContain('"done"');
    });
  });

  describe('return 码正确性：合并失败路径使用 return 2 而非 return 1', () => {
    it('devloop-check.sh 不含 return 1（所有路径返回 0 或 2）', () => {
      // 确保合并失败时使用 return 2（blocked），不使用 return 1（error）
      // 防止工作流因 return 1 被误判为脚本错误而终止
      expect(content).not.toMatch(/^\s*return 1\b/m);
    });

    it('devloop-check.sh 合并失败块包含 return 2', () => {
      // 合并失败块紧跟在 "合并失败" 日志之后，必须以 return 2 结尾
      const mergeFailIdx = content.indexOf('合并失败');
      expect(mergeFailIdx).toBeGreaterThan(-1);
      const section = content.substring(mergeFailIdx, mergeFailIdx + 500);
      expect(section).toContain('return 2');
    });
  });
});

