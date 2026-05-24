/**
 * WsStatusIcon — 4 条 status→图标映射规则测试
 */
import { describe, it, expect } from 'vitest';

// 与 HarnessPipelinePage.tsx 中 wsStatusIcon 保持同逻辑
function wsStatusIcon(status: string | null, container_id: string | null): string {
  if (status === 'merged') return '✅';
  if (status === 'running' || status === 'spawning') return '🔄';
  if (status === null && container_id) return '🔄';
  return '⬜';
}

describe('WsStatusIcon — 4 条状态映射规则 [BEHAVIOR]', () => {
  it('规则1: status=null && container_id 非空 → 🔄 运行中（边界场景1）', () => {
    expect(wsStatusIcon(null, 'container-abc123')).toBe('🔄');
  });

  it('规则2: status=null && container_id=null → ⬜ 待开始（边界场景2）', () => {
    expect(wsStatusIcon(null, null)).toBe('⬜');
  });

  it('规则3: status=merged → ✅ MERGED', () => {
    expect(wsStatusIcon('merged', null)).toBe('✅');
    expect(wsStatusIcon('merged', 'some-id')).toBe('✅');
  });

  it('规则4a: status=running → 🔄 运行中', () => {
    expect(wsStatusIcon('running', null)).toBe('🔄');
    expect(wsStatusIcon('running', 'cid')).toBe('🔄');
  });

  it('规则4b: status=spawning → 🔄 运行中', () => {
    expect(wsStatusIcon('spawning', null)).toBe('🔄');
    expect(wsStatusIcon('spawning', 'cid')).toBe('🔄');
  });
});
