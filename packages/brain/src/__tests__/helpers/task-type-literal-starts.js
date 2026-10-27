import { tokenizer } from 'acorn';

// 仅确定 A/C 真实代码起点；原字符串成员及 SQL 输入不变。
// 同次词法扫描去注释且保留位置，避免旧去注释器把 regexp 中的 // 当成注释。
// 模板 quasi/regexp 不产生内部括号 token，${...} 内仍遍历；词法错误直接抛出。
export function literalSource(source) {
  const comments = [], starts = [];
  for (const token of tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module',
    onComment: (_block, _text, start, end) => comments.push([start, end]),
  })) {
    if (token.type.label === '[' || token.type.label === '{') {
      starts.push({ index: token.start, isArray: token.type.label === '[' });
    }
  }
  const chars = source.split('');
  for (const [start, end] of comments) for (let i = start; i < end; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  }
  return { source: chars.join(''), starts };
}
