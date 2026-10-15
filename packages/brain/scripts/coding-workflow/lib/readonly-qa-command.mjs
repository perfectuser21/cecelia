// 只识别完整静态 node-e，或这一种已知的只读健康探针封套；不是通用 Shell 解析器。
import { literalWord } from './shell-command.mjs';
const HEALTH_PREFIX = /^PREVIEW_URL=http:\/\/(?:localhost|127\.0\.0\.1):[1-9][0-9]{0,4}; SHA=\$\(git rev-parse HEAD\); curl -fsS "\$PREVIEW_URL\/api\/brain\/health" \| jq -e --arg sha "\$SHA" '\.git_sha == \$sha' && /;

export function readonlyQaScript(command, { allowHealthPrefix = true } = {}) {
  if (typeof command !== 'string') return null;
  const source = allowHealthPrefix ? command.replace(HEALTH_PREFIX, '') : command;
  const prefix = /^[ \t]*(?:(?:\/usr\/bin\/|\/usr\/local\/bin\/|\/opt\/homebrew\/bin\/)?node)[ \t]+-e[ \t]+/.exec(source);
  if (!prefix) return null;
  return literalWord(source.slice(prefix[0].length).replace(/[ \t]+$/, ''));
}
