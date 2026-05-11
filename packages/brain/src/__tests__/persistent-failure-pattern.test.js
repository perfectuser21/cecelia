/**
 * persistent-failure-pattern.test.js
 *
 * 验证 monitor-loop 对"持续性失败 pattern (同 reason_code ≥3 次 / 近 3 周)"的响应路径：
 *   quarantine → rca → fix_task，永远不是 retry
 *
 * 根因：learning_id a7e564b3 — 当前 monitor-loop 只在失败率 spike (>30%/1h)
 * 时才走 RCA → auto-fix；当失败是慢速累积 (≥3 次/3 周) 而非 spike 时，
 * 这些 pattern 被静默吞掉。handleStuckRun 也是先 retry 两轮才 quarantine，
 * 违反 "持续性失败永远不 retry" 的洞察。
 *
 * 新行为：
 *   1. detectPersistentFailurePatterns() 查询 run_events 过去 21 天内
 *      同 reason_code 失败 ≥ 3 次的 pattern
 *   2. handlePersistentPattern(pattern) 强制路径：
 *      - 调 quarantineTask 把命中任务移出 retry 通道
 *      - 调 shouldAnalyzeFailure + cacheRcaResult 跑 RCA（24h 去重保留）
 *      - 调 dispatchToDevSkill 生成 fix_task
 *      - 绝不出现 retry-style 重派（status: 'queued' update）
 *   3. runMonitorCycle 每轮调用 detectPersistentFailurePatterns
 *
 * 采用静态源读取 + 正则断言模式（同 dispatch-codex-bridge-preflight.test.js），
 * 不实际跑 SQL，CI 不需要起真 DB。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const monitorSrc = readFileSync(join(__dirname, '../monitor-loop.js'), 'utf8');

function getFnBody(src, fnSig) {
  const fnStart = src.indexOf(fnSig);
  if (fnStart < 0) return '';
  // 寻找下一个顶层 function/async function 起始作为函数结束界
  const tail = src.slice(fnStart + fnSig.length);
  const nextMatch = tail.search(/\n(?:async\s+)?function\s+\w/);
  return src.slice(fnStart, nextMatch > 0 ? fnStart + fnSig.length + nextMatch : fnStart + 6000);
}

describe('detectPersistentFailurePatterns: 跨任务慢速累积 pattern 检测', () => {
  const fnBody = getFnBody(monitorSrc, 'async function detectPersistentFailurePatterns');

  it('函数存在', () => {
    expect(fnBody.length).toBeGreaterThan(0);
  });

  it('时间窗口为 21 天 / 3 周（覆盖洞察 "≥3 次/3 周" 的时间维度）', () => {
    // 接受 INTERVAL '21 days' 或 INTERVAL '3 weeks' 两种写法
    expect(fnBody).toMatch(/INTERVAL\s+'(?:21\s+days|3\s+weeks)'/);
  });

  it('阈值为 ≥ 3 次（覆盖洞察 "≥3 次" 的次数维度）', () => {
    // HAVING COUNT(*) >= 3 或 等价 SQL
    expect(fnBody).toMatch(/HAVING\s+COUNT\(\*\)\s*>=\s*3/i);
  });

  it('按 reason_code 聚合（pattern 单位是 reason_code，不是单个任务）', () => {
    expect(fnBody).toMatch(/GROUP\s+BY[\s\S]{0,200}reason_code/i);
    expect(fnBody).toMatch(/FROM\s+run_events/i);
    expect(fnBody).toMatch(/status\s*=\s*'failed'/i);
  });
});

describe('handlePersistentPattern: 路径强制 quarantine → rca → fix_task，永远不是 retry', () => {
  const fnBody = getFnBody(monitorSrc, 'async function handlePersistentPattern');

  it('函数存在', () => {
    expect(fnBody.length).toBeGreaterThan(0);
  });

  it('调 quarantineTask 把命中任务移出 retry 通道', () => {
    expect(fnBody).toMatch(/quarantineTask\s*\(/);
  });

  it('调 shouldAnalyzeFailure 做 RCA 24h 去重 + 调 callCortexForRca 跑分析', () => {
    expect(fnBody).toMatch(/shouldAnalyzeFailure\s*\(/);
    expect(fnBody).toMatch(/callCortexForRca\s*\(/);
    expect(fnBody).toMatch(/cacheRcaResult\s*\(/);
  });

  it('调 dispatchToDevSkill 生成 fix_task（auto-fix PRD）', () => {
    expect(fnBody).toMatch(/dispatchToDevSkill\s*\(/);
  });

  it('绝不出现 retry-style 重派（不 update status 回 queued）', () => {
    // 该函数实现里禁止把任务 status 重新置回 'queued'，避免回到 retry 循环
    expect(fnBody).not.toMatch(/status\s*=\s*'queued'/);
    expect(fnBody).not.toMatch(/['"]status['"]\s*:\s*['"]queued['"]/);
  });
});

describe('runMonitorCycle: 每轮主循环都跑 persistent pattern 检测', () => {
  const fnBody = getFnBody(monitorSrc, 'async function runMonitorCycle');

  it('函数存在', () => {
    expect(fnBody.length).toBeGreaterThan(0);
  });

  it('调用 detectPersistentFailurePatterns', () => {
    expect(fnBody).toMatch(/detectPersistentFailurePatterns\s*\(/);
  });

  it('对每个命中的 pattern 调 handlePersistentPattern', () => {
    expect(fnBody).toMatch(/handlePersistentPattern\s*\(/);
  });
});
