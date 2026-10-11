// runner 主日志不变式（C1 runner-log-noise）：runner 进程内的 claude 会话（ci-fix/qa-fix/commander）
// 输出只落 <logDir>/<kind>-<pr>-<后缀>.log，主日志（run-once 的 stderr）只留一行「会话 … 结束」摘要。
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';

/** 断言会话正文不进主日志、摘要恰一行、会话文件含全文；返回会话文件路径。 */
export function expectSessionOnlyInFile(stderr, logDir, { tag, kind, pr, cost }) {
  expect(stderr).not.toContain('FAKE_SESSION_BODY');
  expect(stderr).not.toContain('FAKE_SESSION_STDERR');
  const lines = stderr.split('\n').filter(Boolean);
  expect(lines.filter((l) => l.startsWith('{'))).toEqual([]);
  // 主日志每行都是带时间戳的一行级运行事件
  expect(lines.filter((l) => !l.startsWith('['))).toEqual([]);
  const costRe = String(cost).replace('.', '\\.');
  const summary = lines.filter((l) => l.includes(`会话 ${tag} PR #${pr} 结束`));
  expect(summary).toHaveLength(1);
  expect(summary[0]).toMatch(new RegExp(`会话 ${tag} PR #${pr} 结束：exit 0.*\\$${costRe}.*${kind}-${pr}-\\d+\\.log`));
  const files = fs.readdirSync(logDir).filter((n) => new RegExp(`^${kind}-${pr}-\\d+\\.log$`).test(n));
  expect(files).toHaveLength(1);
  const text = fs.readFileSync(path.join(logDir, files[0]), 'utf8');
  expect(text).toContain('FAKE_SESSION_BODY');
  expect(text).toContain('FAKE_SESSION_STDERR');
  expect(text).toContain('"type":"result"');
  // 结论摘录压成一行进摘要
  expect(summary[0]).toContain('「修完了 第二行」');
  return path.join(logDir, files[0]);
}
