// 只识别完整静态 node-e，或这一种已知的只读健康探针封套；不是通用 Shell 解析器。
const HEALTH_PREFIX = /^PREVIEW_URL=http:\/\/(?:localhost|127\.0\.0\.1):[1-9][0-9]{0,4}; SHA=\$\(git rev-parse HEAD\); curl -fsS "\$PREVIEW_URL\/api\/brain\/health" \| jq -e --arg sha "\$SHA" '\.git_sha == \$sha' && /;

export function readonlyQaScript(command) {
  if (typeof command !== 'string') return null;
  const source = command.replace(HEALTH_PREFIX, '');
  const prefix = /^[ \t]*(?:(?:\/usr\/bin\/|\/usr\/local\/bin\/|\/opt\/homebrew\/bin\/)?node)[ \t]+-e[ \t]+/.exec(source);
  if (!prefix) return null;
  const rest = source.slice(prefix[0].length);
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
