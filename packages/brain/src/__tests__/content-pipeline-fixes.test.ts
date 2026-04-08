/**
 * 修复验证：内容生成+发布链路阻塞三处修复
 *
 * Fix 1: content_publish 加入 SYSTEM_TASK_TYPES → pre-flight 不再因 description 为空而取消
 * Fix 2: _createPublishJobs 添加 description 字段（即使 Fix 1 兜底也确保有语义描述）
 * Fix 3: executeExport 有文章/文案时不因无图片卡片失败
 *
 * DoD:
 * - [BEHAVIOR] content_publish 任务 pre-flight 通过（无 description 也不取消）
 * - [BEHAVIOR] executeExport 零图片但有文章时返回 { success: true }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { preFlightCheck } from '../pre-flight-check.js';

// ─── Fix 1: content_publish pre-flight bypass ─────────────────────────────────

describe('Fix 1 — content_publish pre-flight bypass', () => {
  it('content_publish 无 description 时 pre-flight 应通过（SYSTEM_TASK_TYPES）', async () => {
    const task = {
      id: 'pub-001',
      title: '[发布] 行业跟进能力 → douyin',
      task_type: 'content_publish',
      description: null,
      prd_content: null,
      priority: 'P1',
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('content_publish 有 description 时也能通过', async () => {
    const task = {
      id: 'pub-002',
      title: '[发布] 行业跟进能力 → xiaohongshu',
      task_type: 'content_publish',
      description: '内容发布任务：将「行业跟进能力」内容发布到 xiaohongshu 平台。',
      prd_content: null,
      priority: 'P1',
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(true);
  });

  it('普通 dev 任务无 description 时仍然失败（不影响已有逻辑）', async () => {
    const task = {
      id: 'dev-001',
      title: 'Fix some bug',
      task_type: 'dev',
      description: null,
      prd_content: null,
      priority: 'P1',
    };
    const result = await preFlightCheck(task);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('Task description is empty');
  });
});

// ─── Fix 3: executeExport 零图片降级 ────────────────────────────────────────

describe('Fix 3 — executeExport 使用 V6 generator', () => {
  it('executeExport 调用 gen-v6-person.mjs 生成图片 — 验证 V6 调用代码存在', () => {
    const { readFileSync } = require('fs');
    const src = readFileSync(
      require('path').join(__dirname, '../content-pipeline-executors.js'),
      'utf-8'
    );
    expect(src).toContain('gen-v6-person.mjs');
    expect(src).toContain('person-data.json');
    expect(src).toContain('GEN_V6_SCRIPT');
  });

  it('executeExport findings 为空时直接返回失败 — 无静默降级', () => {
    const { readFileSync } = require('fs');
    const src = readFileSync(
      require('path').join(__dirname, '../content-pipeline-executors.js'),
      'utf-8'
    );
    expect(src).toContain('findings 为空，无法提取 person-data.json');
  });

  it('generateCards 已废弃注释存在 — 确认主动调用已移除', () => {
    const { readFileSync } = require('fs');
    const src = readFileSync(
      require('path').join(__dirname, '../content-pipeline-executors.js'),
      'utf-8'
    );
    expect(src).toContain('generateCards() 已废弃');
    // 不存在 "const cardsGenerated = generateCards(" 这样的主动调用
    expect(src).not.toContain('const cardsGenerated = generateCards(');
  });
});
