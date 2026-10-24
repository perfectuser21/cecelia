// 仅静态解码 Codex command_execution 中的一层已知 shell -c/-lc argv 展示。
// 不运行 shell、不展开变量；不解析内层脚本，不从复合命令中截取子串。
const SHELL_PREFIX = /^(?:(?:\/bin\/|\/usr\/bin\/|\/usr\/local\/bin\/|\/opt\/homebrew\/bin\/)?(?:bash|sh|zsh))[ \t]+-(?:lc|c)[ \t]+/;

/** 一个静态 shell word，可由相邻单/双引号片段拼接；动态扩展或额外参数返回 null。 */
export function literalWord(text) {
  let out = '';
  let quote = null;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else out += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '$' || ch === '`') return null;
      else if (ch === '\\') {
        if (i + 1 === text.length) return null;
        const next = text[++i];
        // POSIX 双引号内：只对 $ ` " \\ 换行去转义，\\n 不能变换成换行。
        if (next === '\n') continue;
        out += '$`"\\'.includes(next) ? next : `\\${next}`;
      } else out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
    } else if (ch === '\\') {
      if (i + 1 === text.length) return null;
      const next = text[++i];
      if (next !== '\n') out += next;
    } else {
      // 只接纳显式引用/转义的单个参数，拒控制符、注释、空白分隔和裸扩展。
      return null;
    }
  }
  return quote === null && quoted ? out : null;
}

export function unwrapShellCommand(command) {
  const text = String(command).trim();
  const prefix = SHELL_PREFIX.exec(text);
  return prefix ? literalWord(text.slice(prefix[0].length)) : text;
}

/**
 * 解一层原生展示后全文核对。唯一例外：完整静态 shell -c/-lc 调用的
 * 唯一引用参数闭合后一个 LF；不裁剪参数内部脚本，也不解释任意脚本语法。
 * 原始 command 保持不变，动态参数、额外命令/参数和更多尾字符均不走例外。
 */
export function matchesShellEvidence(command, reported) {
  if (command === reported) return true;
  const decoded = unwrapShellCommand(command);
  if (decoded === reported) return true;
  if (decoded !== reported + '\n') return false;
  const prefix = SHELL_PREFIX.exec(reported);
  return Boolean(prefix) && literalWord(reported.slice(prefix[0].length)) !== null;
}
