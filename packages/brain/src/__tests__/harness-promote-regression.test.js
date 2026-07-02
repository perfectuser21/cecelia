/**
 * harness-promote-regression.test.js — A3 冻结登记单测。
 * 纯函数：parseBehaviorEntries / parseGoldenPathSteps / buildGoldenPathEntries / mergeGoldenPaths
 * 主函数：promoteToRegression（mock pool + execFile + fs 注入，见 Task 2 追加的 describe）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseBehaviorEntries,
  parseGoldenPathSteps,
  buildGoldenPathEntries,
  mergeGoldenPaths,
} from '../harness-promote-regression.js';

describe('parseBehaviorEntries', () => {
  it('标准格式：desc + manual: 命令成对提取', () => {
    const md = [
      '## BEHAVIOR 条目',
      '',
      '- [ ] [BEHAVIOR] 发布成功且 DB 有新记录',
      "  Test: manual:bash -c 'curl -s $API | jq -e \".ok\"'",
      '- [x] [BEHAVIOR] 页面显示文字',
      '  Test: manual:node -e "process.exit(0)"',
    ].join('\n');
    const out = parseBehaviorEntries(md);
    expect(out).toHaveLength(2);
    expect(out[0].desc).toBe('发布成功且 DB 有新记录');
    expect(out[0].cmd).toBe("bash -c 'curl -s $API | jq -e \".ok\"'");
    expect(out[1].desc).toBe('页面显示文字');
    expect(out[1].cmd).toBe('node -e "process.exit(0)"');
  });

  it('无 Test: manual: 行的 BEHAVIOR 条目被跳过（不产半卡）', () => {
    const md = '- [ ] [BEHAVIOR] 只有描述没有命令\n\n- [ ] [BEHAVIOR] 有命令\n  Test: manual:true';
    const out = parseBehaviorEntries(md);
    expect(out).toHaveLength(1);
    expect(out[0].cmd).toBe('true');
  });

  it('无匹配 → 空数组', () => {
    expect(parseBehaviorEntries('# 空文档')).toEqual([]);
  });
});

describe('parseGoldenPathSteps', () => {
  it('标准 ## Golden Path 段编号列表', () => {
    const md = [
      '# sprint-prd',
      '## Golden Path（核心场景）',
      '用户从 [入口] → 到达 [出口]',
      '具体：',
      '1. 用户点击发布',
      '2. 系统调用 API',
      '3. 页面出现成功提示',
      '',
      '## 下一段',
    ].join('\n');
    const out = parseGoldenPathSteps(md);
    expect(out).toEqual([
      { order_no: 1, note: '用户点击发布' },
      { order_no: 2, note: '系统调用 API' },
      { order_no: 3, note: '页面出现成功提示' },
    ]);
  });

  it('段缺失 → 空数组（调用方降级到 BEHAVIOR 序号）', () => {
    expect(parseGoldenPathSteps('# 无 golden path 段')).toEqual([]);
  });
});

describe('buildGoldenPathEntries', () => {
  const base = {
    taskId: 'bd7e251c-0000-0000-0000-000000000001',
    journeyId: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
    behaviors: [
      { desc: '发布成功', cmd: 'bash -c true' },
      { desc: '记录落库', cmd: 'psql "$DB" -c "SELECT 1" | grep -q 1' },
    ],
    prUrl: 'https://github.com/x/y/pull/1',
    sprintDir: 'sprints/0702-demo',
    now: '2026-07-02T03:00:00.000Z',
  };

  it('每个 BEHAVIOR 一条，schema 对齐 run-core-regression.sh 消费字段', () => {
    const out = buildGoldenPathEntries(base);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 'GP-bd7e251c-001',
      name: '发布成功',
      priority: 'P0',
      trigger: ['PR', 'Release'],
      method: 'auto',
      test_command: 'bash -c true',
      owner_task_id: base.taskId,
      journey_id: base.journeyId,
    });
    expect(out[1].id).toBe('GP-bd7e251c-002');
    expect(out[0].source).toMatchObject({
      pr_url: base.prUrl,
      sprint_dir: base.sprintDir,
      frozen_at: base.now,
    });
  });
});

describe('mergeGoldenPaths', () => {
  it('幂等：同 task 前缀旧条目被覆盖，跑两次条目数不翻倍', () => {
    const fresh = [
      { id: 'GP-bd7e251c-001', name: 'v2 卡片', test_command: 'true' },
    ];
    const existing = [
      { id: 'CORE-001', name: '别人的卡', test_command: 'node --check x.js' },
      { id: 'GP-bd7e251c-001', name: 'v1 旧卡', test_command: 'false' },
      { id: 'GP-bd7e251c-002', name: 'v1 已删步骤的旧卡', test_command: 'false' },
    ];
    const merged = mergeGoldenPaths(existing, fresh, 'GP-bd7e251c-');
    expect(merged).toHaveLength(2);
    expect(merged.find((g) => g.id === 'CORE-001')).toBeTruthy();
    expect(merged.find((g) => g.id === 'GP-bd7e251c-001').name).toBe('v2 卡片');
    expect(merged.find((g) => g.id === 'GP-bd7e251c-002')).toBeUndefined();
    // 再跑一次不翻倍
    const twice = mergeGoldenPaths(merged, fresh, 'GP-bd7e251c-');
    expect(twice).toHaveLength(2);
  });

  it('existing 为空/undefined 容忍', () => {
    expect(mergeGoldenPaths(undefined, [{ id: 'GP-a-001' }], 'GP-a-')).toHaveLength(1);
  });
});
