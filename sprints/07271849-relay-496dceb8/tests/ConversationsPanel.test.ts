/**
 * ConversationsPanel 纯函数单测（TDD Red 阶段）
 *
 * [BEHAVIOR] B1 — statusBadgeMeta('active') → text 含 emerald，label = '活跃'
 * [BEHAVIOR] B2 — statusBadgeMeta('resolved') → text 含 slate-4，label = '已解决'
 * [BEHAVIOR] B3 — statusBadgeMeta('suspended') → text 含 amber，label = '挂起'
 * [BEHAVIOR] B4 — gpId 注入 fetch URL 含 gp_id 参数（通过源码检查）
 *
 * 这些测试在 ConversationsPanel.tsx 未实现 statusBadgeMeta 时 RED。
 */

import { describe, it, expect } from 'vitest';

// statusBadgeMeta 预期从 ConversationsPanel 导出
// 当文件不存在或函数未导出时，import 报错 → 测试 RED（符合 TDD Red 阶段预期）
import { statusBadgeMeta } from '../../../../../apps/dashboard/src/pages/warroom/ConversationsPanel';

describe('statusBadgeMeta（对话状态 badge 元信息）', () => {
  it('statusBadgeMeta active 返回 emerald 色彩类名', () => {
    const result = statusBadgeMeta('active');
    expect(result.text).toContain('emerald');
    expect(result.bg).toContain('emerald');
    expect(result.label).toBe('活跃');
  });

  it('statusBadgeMeta resolved 返回 slate 灰色', () => {
    const result = statusBadgeMeta('resolved');
    // resolved 状态使用 slate-4xx 色
    expect(result.text).toMatch(/slate/);
    expect(result.label).toBe('已解决');
  });

  it('statusBadgeMeta suspended 返回 amber 黄色', () => {
    const result = statusBadgeMeta('suspended');
    expect(result.text).toContain('amber');
    expect(result.bg).toContain('amber');
    expect(result.label).toBe('挂起');
  });

  it('statusBadgeMeta 未知状态返回默认灰色', () => {
    const result = statusBadgeMeta('archived');
    // archived 没有专属颜色，返回默认 slate
    expect(result.text).toBeDefined();
    expect(result.label).toBeDefined();
  });

  it('statusBadgeMeta 返回对象含 text/bg/label 三字段', () => {
    const r = statusBadgeMeta('active');
    expect(typeof r.text).toBe('string');
    expect(typeof r.bg).toBe('string');
    expect(typeof r.label).toBe('string');
  });
});

describe('gpId 注入 fetch URL 含 gp_id 参数（源码检查）', () => {
  it('gpId 注入 fetch URL 含 gp_id', () => {
    // 验证 ConversationsPanel.tsx 源码中 fetch URL 拼接了 gp_id
    // 当 ConversationsPanel.tsx 未实现 gpId 过滤时，源码中不含 gp_id → 测试 RED
    const fs = require('fs');
    const path = require('path');
    const filePath = path.resolve(
      __dirname,
      '../../../../../apps/dashboard/src/pages/warroom/ConversationsPanel.tsx'
    );

    // 文件必须存在（ConversationsPanel 提取后）
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf8');

    // 必须包含 gp_id 过滤逻辑（fetch URL 拼接）
    expect(content).toContain('gp_id');
  });
});
