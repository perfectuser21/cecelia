// runner 会话日志（C1 runner-log-noise）：会话文件路径命名与主日志一行摘要。
import { describe, it, expect } from 'vitest';
import { sessionLogPath, sessionSummary } from '../lib/session-log.mjs';

const resultLine = (extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 9, duration_ms: 91400, total_cost_usd: 0.7, result: 'J-1 已按裁判意见修完', ...extra });
const run = (extra = {}) => ({ code: 0, timedOut: false, terminated: false, cost_usd: 0.7, transcriptPath: '/l/qa-fix-6232-1.log', stdout: `做了点事\n${resultLine()}\n`, ...extra });

describe('sessionLogPath', () => {
  it('落在 logDir 顶层，沿用 <kind>-<pr>-<后缀>.log 命名（保留期清理按顶层 *.log 覆盖）', () => {
    expect(sessionLogPath({ logDir: '/l' }, 'cifix', 77, 123)).toBe('/l/cifix-77-123.log');
    expect(sessionLogPath({ logDir: '/l' }, 'commander', 77, 2)).toBe('/l/commander-77-2.log');
  });
});

describe('sessionSummary', () => {
  it('正常 result 行：exit、轮数、时长、花费、结论摘录、会话文件路径，单行', () => {
    const s = sessionSummary('qa-fix', 6232, run());
    expect(s).toBe('会话 qa-fix PR #6232 结束：exit 0，9 轮，91s，$0.7，「J-1 已按裁判意见修完」→ /l/qa-fix-6232-1.log');
  });

  it('没有 result 行（纯文本旧格式）：只带 exit 与花费，不抛错', () => {
    const s = sessionSummary('ci-fix', 1, run({ stdout: '## 总结\n| a | b |\n', cost_usd: 0 }));
    expect(s).toBe('会话 ci-fix PR #1 结束：exit 0，$0 → /l/qa-fix-6232-1.log');
  });

  it('result 行 JSON 损坏：降级为不带摘录，不抛错', () => {
    const s = sessionSummary('ci-fix', 1, run({ stdout: '{"type":"result","num_turns":' }));
    expect(s).not.toContain('「');
    expect(s).toContain('exit 0');
  });

  it('超时 / 被终止 / 未拿到退出码 / 会话报错 都写进摘要', () => {
    expect(sessionSummary('commander', 2, run({ code: null, timedOut: true, stdout: '' }))).toContain('exit 无，超时');
    expect(sessionSummary('commander', 2, run({ code: 143, terminated: true, stdout: '' }))).toContain('exit 143，被终止');
    expect(sessionSummary('commander', 2, run({ code: 1, stdout: resultLine({ is_error: true, subtype: 'error_max_turns' }) }))).toContain('会话报错 error_max_turns');
  });

  it('结论含换行压成一行；超过 80 字截断加省略号', () => {
    const s = sessionSummary('qa-fix', 1, run({ stdout: resultLine({ result: `第一行\n\n第二行  |表格|\n${'长'.repeat(200)}` }) }));
    expect(s.split('\n')).toHaveLength(1);
    const excerpt = /「(.*)」/.exec(s)[1];
    expect(excerpt.startsWith('第一行 第二行 |表格| 长')).toBe(true);
    expect(excerpt).toHaveLength(81);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('没有会话文件路径（不应发生）：不带箭头', () => {
    expect(sessionSummary('ci-fix', 1, run({ transcriptPath: undefined }))).not.toContain('→');
  });
});
