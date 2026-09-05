// 冻结合同测试（TDD Red）— 四格路由器核心
// 从仓库根跑：npx vitest run sprints/09052154-kernel-fa6b66ce/tests/four-lane-router.test.ts
// 红证据：classifyArtifactKind / routeFourQuadrant / judgeAnswerKnown 尚未从 task-router.js 导出。
// 禁 mock 边：本文件只测纯函数与兜底逻辑，不触碰 DB 写路径（那条边由 E2E 真 psql 验证）；
//   judgeAnswerKnown 的 llm 依赖是第三方外部边界，按合同允许注入替身以确定性验证兜底分支。
import { describe, it, expect } from 'vitest';
import {
  classifyArtifactKind,
  routeFourQuadrant,
  judgeAnswerKnown,
} from '../../../packages/brain/src/task-router.js';

describe('四格路由器 [BEHAVIOR]', () => {
  it('classifyArtifactKind 规则：编码类 task_type 判 code', () => {
    expect(classifyArtifactKind({ task_type: 'dev' })).toBe('code');
    expect(classifyArtifactKind({ task_type: 'harness_generate' })).toBe('code');
    expect(classifyArtifactKind({ task_type: 'research', change_kind: 'code' })).toBe('code');
  });

  it('classifyArtifactKind 规则：空 description 非编码类判 execution 不抛异常', () => {
    // 边界：description 缺失/为空必须给确定取值，不抛异常
    expect(classifyArtifactKind({ task_type: 'research' })).toBe('execution');
    expect(classifyArtifactKind({ task_type: 'content_publish', description: '' })).toBe('execution');
    // artifact_kind 恒为两枚举之一
    expect(['code', 'execution']).toContain(classifyArtifactKind({}));
  });

  it('routeFourQuadrant 四格互斥完备：4 组合各命中唯一 lane', () => {
    expect(routeFourQuadrant('code', true)).toBe('dev');
    expect(routeFourQuadrant('code', false)).toBe('prototype_dev');
    expect(routeFourQuadrant('execution', true)).toBe('canvas_skill');
    expect(routeFourQuadrant('execution', false)).toBe('skill_explore');

    // 互斥完备：遍历 4 组合，每个命中且仅命中一个 lane，4 个 lane 两两不同
    const lanes = new Set<string>();
    for (const ak of ['code', 'execution'] as const) {
      for (const known of [true, false] as const) {
        const lane = routeFourQuadrant(ak, known);
        expect(['dev', 'prototype_dev', 'canvas_skill', 'skill_explore']).toContain(lane);
        lanes.add(lane);
      }
    }
    expect(lanes.size).toBe(4); // 4 组合 → 4 个互异 lane（完备且互斥）
  });

  it('judgeAnswerKnown LLM 兜底：注入 llm 抛错时确定性返回 unknown 不抛', async () => {
    const throwingLlm = async () => { throw new Error('LLM timeout'); };
    const res = await judgeAnswerKnown(
      { title: '调研一个未知方向', description: '' },
      { llm: throwingLlm },
    );
    // 确定性兜底：不抛异常，answer_known 为确定布尔（默认 unknown=false），标记来源
    expect(res.answer_known).toBe(false);
    expect(res.source).toBe('fallback');
  });

  it('judgeAnswerKnown 正常：注入 llm 返回 known → answer_known true', async () => {
    const knownLlm = async () => ({ text: 'known' });
    const res = await judgeAnswerKnown(
      { title: '把已知公式实现成函数', description: '照着做即可' },
      { llm: knownLlm },
    );
    expect(res.answer_known).toBe(true);
    expect(res.source).toBe('llm');
  });
});
