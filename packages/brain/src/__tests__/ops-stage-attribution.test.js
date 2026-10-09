import { describe, it, expect } from 'vitest';
import { parseN8nExecutionStages, aggregateStageStats } from '../ops-collector.js';

// n8n execution_data.data 是**扁平化指针格式**：顶层数组，字符串数字是索引引用。
// 实证结构（AwrSocialLeadgenV4 真实一条）：[0]=索引表 → resultData → runData → 各节点
const FLAT = [
  { version: 1, resultData: '1' },                       // 0
  { runData: '2', lastNodeExecuted: '3' },               // 1
  { '阶段 手机预检': '4', '阶段 视频发现': '6', '裁决 手机预检': '8' }, // 2
  '记录 中止终局',                                        // 3
  ['5'],                                                 // 4
  { executionStatus: 'success', executionTime: 351434 }, // 5
  ['7'],                                                 // 6
  { executionStatus: 'error', executionTime: 764197 },   // 7
  ['9'],                                                 // 8
  { executionStatus: 'success', executionTime: 4 },      // 9
];

describe('parseN8nExecutionStages — 从扁平指针格式拆出阶段执行', () => {
  it('只取「阶段 X」节点，剥掉前缀并带状态/耗时', () => {
    const r = parseN8nExecutionStages(FLAT);
    expect(r.stages).toEqual([
      { stage: '手机预检', status: 'success', duration_sec: 351 },
      { stage: '视频发现', status: 'error', duration_sec: 764 },
    ]);
  });

  it('裁决/准备等非阶段节点不计入（它们不是业务阶段）', () => {
    expect(parseN8nExecutionStages(FLAT).stages.some((s) => s.stage.includes('裁决'))).toBe(false);
  });

  it('透出 lastNodeExecuted——这次跑到哪一步停的', () => {
    expect(parseN8nExecutionStages(FLAT).last_node).toBe('记录 中止终局');
  });

  it('畸形/空数据不抛（采集腿不能因一条坏记录整体死）', () => {
    expect(parseN8nExecutionStages(null).stages).toEqual([]);
    expect(parseN8nExecutionStages([]).stages).toEqual([]);
    expect(parseN8nExecutionStages([{ version: 1 }]).stages).toEqual([]);
  });
});

describe('aggregateStageStats — 阶段→skill 归因汇总', () => {
  const MAP = { 手机预检: 'douyin-phone-runtime', 视频发现: 'social-video-discovery' };

  it('按 skill 汇总次数/成功率/平均耗时', () => {
    const execs = [
      { stages: [{ stage: '手机预检', status: 'success', duration_sec: 300 },
                 { stage: '视频发现', status: 'error', duration_sec: 700 }] },
      { stages: [{ stage: '手机预检', status: 'success', duration_sec: 400 },
                 { stage: '视频发现', status: 'success', duration_sec: 800 }] },
    ];
    const s = aggregateStageStats(execs, MAP);
    expect(s.get('douyin-phone-runtime')).toEqual({ runs: 2, success: 2, success_rate: 100, avg_sec: 350 });
    expect(s.get('social-video-discovery')).toEqual({ runs: 2, success: 1, success_rate: 50, avg_sec: 750 });
  });

  it('映射不到 skill 的阶段被跳过（禁把未知阶段算进某个 skill）', () => {
    const s = aggregateStageStats([{ stages: [{ stage: '没映射的阶段', status: 'success', duration_sec: 10 }] }], MAP);
    expect(s.size).toBe(0);
  });

  it('空输入 → 空 Map 不抛', () => {
    expect(aggregateStageStats([], MAP).size).toBe(0);
    expect(aggregateStageStats(null, MAP).size).toBe(0);
  });
});
