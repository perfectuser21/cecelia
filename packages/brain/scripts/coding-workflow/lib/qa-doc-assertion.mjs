// 有限文档断言语言，不是 JS 安全分析器。未知语法保守拒绝；不执行、不删字符串。
// 固定绑定 fs/p/s/x：require fs → 读相对 Markdown → 逐词 includes，否则 throw → 打印静态消息。

/** 只接受完整 node -e 的单个静态引号参数；不接受 shell 包装、展开、拼接或额外 argv。 */
function scriptArgument(command) {
  const prefix = /^[ \t]*(?:(?:\/usr\/bin\/|\/usr\/local\/bin\/|\/opt\/homebrew\/bin\/)?node)[ \t]+-e[ \t]+/.exec(command);
  if (!prefix) return null;
  const rest = command.slice(prefix[0].length);
  const quote = rest[0];
  if (quote !== "'" && quote !== '"') return null;
  let out = '';
  for (let i = 1; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === quote) return /^[ \t]*$/.test(rest.slice(i + 1)) ? out : null;
    if (quote === '"') {
      if (ch === '$' || ch === '`') return null;
      if (ch === '\\') {
        const next = rest[++i];
        if (next !== '"' && next !== '\\') return null;
        out += next;
        continue;
      }
    }
    out += ch;
  }
  return null;
}

/** 仅 ASCII 标识符/固定标点/空格与 tab/无转义双引号字符串；换行、注释与其他语法拒绝。 */
function tokens(source) {
  const result = [];
  const token = /[ \t]+|"[^"\\\x00-\x1f\x7f\u2028\u2029]*"|[A-Za-z_][A-Za-z0-9_]*|[=();.,\[\]!]/y;
  let offset = 0;
  while (offset < source.length) {
    token.lastIndex = offset;
    const match = token.exec(source);
    if (!match) return null;
    const raw = match[0];
    offset = token.lastIndex;
    if (!/^[ \t]/.test(raw)) result.push(raw);
  }
  return result;
}

/** 只有整个命令匹配且包含 --dry-run 数据断言时，才提供这一条豁免。 */
export function isReadonlyDocAssertion(command) {
  if (typeof command !== 'string') return false;
  const source = scriptArgument(command);
  if (source === null) return false;
  const input = tokens(source);
  if (!input) return false;
  let pos = 0;
  const take = (expected) => {
    for (const token of expected.split(' ')) if (input[pos++] !== token) return false;
    return true;
  };
  const string = () => {
    const token = input[pos++];
    return token?.startsWith('"') ? JSON.parse(token) : null;
  };
  if (!take('const fs = require ( "fs" ) ; const p =')) return false;
  const file = string();
  // 不接纳绝对路径、..、隐藏/动态路径或非 Markdown；这不是文件存在性检查。
  if (file === null || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/.test(file)) return false;
  if (!take('; const s = fs . readFileSync ( p , "utf8" ) ; for ( const x of [')) return false;
  const words = [];
  do {
    const word = string();
    if (!word) return false;
    words.push(word);
    if (input[pos] !== ',') break;
    pos++;
  } while (pos < input.length);
  if (!words.includes('--dry-run')) return false;
  if (!take('] ) if ( ! s . includes ( x ) ) throw Error ( x ) ; console . log (')) return false;
  if (string() === null || !take(')')) return false;
  if (input[pos] === ';') pos++;
  return pos === input.length;
}
