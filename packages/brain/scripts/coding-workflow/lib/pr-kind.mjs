// PR 类型判据（publish 的 PR/提交标题与 build 的 CI 门禁预检共用，保证两处判断一致）：
// 01-intent.md 的 `# 标题` 以 修复/bug/fix 开头 → fix，否则 feat。
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './md-chain.mjs';

const FIX_RE = /^(?:修复|(?:bug|fix)\b)/i;

/** sprint 目录 01-intent.md 的第一个 `# 标题`；文件或标题不存在返回 ''。 */
export function intentHeading(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, '01-intent.md'), 'utf8');
  } catch {
    return '';
  }
  const body = parseFrontmatter(text)?.body ?? text;
  return (/^# (.+)$/m.exec(body)?.[1] ?? '').trim();
}

/** 'fix' | 'feat' */
export const prKindOf = (heading) => (FIX_RE.test(String(heading ?? '').trim()) ? 'fix' : 'feat');
