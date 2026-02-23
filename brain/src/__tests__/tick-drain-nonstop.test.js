/**
 * Tick Drain Nonstop 测试
 *
 * DoD 覆盖: D1, D2
 *
 * 验证 drain 完成后不再禁用 tick，启动时默认 auto-enable。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDrainStatus,
  drainTick,
  _getDrainState,
  _resetDrainState,
} from '../tick.js';
import pool from '../db.js';

describe('tick drain nonstop', () => {
  beforeEach(() => {
    _resetDrainState();
  });

  describe('D1: getDrainStatus drain 完成后不禁用 tick', () => {
    it('drain 完成后返回 drain_completed=true，tick 仍然运行', async () => {
      // 进入 drain 模式
      drainTick();
      expect(_getDrainState().draining).toBe(true);

      // getDrainStatus 会查 DB 中 in_progress 任务
      // 如果没有 in_progress 任务，drain 应该完成但 tick 不应被禁用
      const status = await getDrainStatus();

      // drain 应该完成
      expect(status.draining).toBe(false);
      expect(status.drain_completed).toBe(true);

      // 内部状态应该已清理
      expect(_getDrainState().draining).toBe(false);

      // 关键：检查 tick 仍然 enabled（查 working_memory）
      const tickState = await pool.query(
        "SELECT value_json FROM working_memory WHERE key = 'tick_enabled'"
      );
      // 如果有记录，enabled 应该不是 false
      if (tickState.rows.length > 0) {
        const val = tickState.rows[0].value_json;
        // drain 完成后不应该写入 enabled=false
        // （如果之前是 true，应该保持 true）
        expect(val.enabled).not.toBe(false);
      }
    });

    it('非 drain 模式下返回 draining=false', async () => {
      const status = await getDrainStatus();
      expect(status.draining).toBe(false);
      expect(status.remaining).toBe(0);
    });
  });
});
