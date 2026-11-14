/** Markdown解析只在单行内识别标题，长输入保持线性扫描。 */
const horizontalWhitespace = character => character === ' ' || character === '\t';

export function documentTitle(content, kind) {
  for (const raw of content.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line[0] !== '#' || !horizontalWhitespace(line[1])) continue;
    let start = 1;
    while (horizontalWhitespace(line[start])) start++;
    if (start === line.length) continue;
    let title = line.slice(start);
    if (title.startsWith(kind)) {
      let offset = kind.length;
      while (horizontalWhitespace(title[offset])) offset++;
      if (title[offset] === '-') {
        offset++;
        while (horizontalWhitespace(title[offset])) offset++;
        title = title.slice(offset);
      }
    }
    return title;
  }
  return '';
}

/** 返回首个成功标准段，EOF也是合法段落终点。 */
export function successCriteria(content) {
  const lines = content.split('\n');
  const body = [];
  let found = false;
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!found) {
      const header = /##[ \t]*(?:成功标准|验收标准)|\*\*成功标准\*\*/.exec(line);
      if (!header) continue;
      found = true;
      body.push(line.slice(header.index + header[0].length));
      continue;
    }
    if (line.startsWith('##') || line.startsWith('---')
      || (line.startsWith('**') && line[2] !== '*')) break;
    body.push(line);
  }
  return found ? body.join('\n') : null;
}
