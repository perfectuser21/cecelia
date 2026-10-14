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

// API 面（决策 4fe863c3：改了它的 PR 一条回归 smoke 都没固化就拦合并）：Brain 路由目录、routes.js / *-routes.js / *-route.js、
// Brain 入口 server.js、apps/api 源码。测试文件不算；runner 脚本、纯 UI、其他 Brain 模块不算。
const API_SURFACE_RE = /^(?:packages\/brain\/(?:src\/routes\/|src\/(?:[\w-]+-)?routes?\.js$|server\.js$)|apps\/api\/src\/)/;
const TEST_FILE_RE = /(?:^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$/;

/** PR 改动的文件里有没有 API 面。 */
export function touchesApiSurface(files) {
  return Array.isArray(files) && files.some((f) => API_SURFACE_RE.test(f) && !TEST_FILE_RE.test(f));
}

/** 仅供已成功读取的 Git 路径集；空/未知不是纯文档，不按 sprint 目录豁免截图或源码。 */
export function onlyMarkdownFiles(files) {
  return Array.isArray(files) && files.length > 0
    && files.every((file) => typeof file === 'string' && file.endsWith('.md') && !/[\x00-\x1f\x7f]/.test(file));
}
