/**
 * 总关系图纯抽取器(刀A1):从源码文本抽 spawn/http 边,零 IO。
 * import 边由 scan-graph.mjs 走 dependency-cruiser,不在本文件。
 * spec: docs/superpowers/specs/2026-07-18-graph-photo-layer-design.md
 */
const SCRIPT_EXT_RE = /\.(sh|mjs|cjs|py|js)$/;

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

export function extractSpawnEdges(content, srcPath) {
  const edges = [];
  const re = /\b(spawn|execFile|execSync|exec)\(\s*(['"`])((?:(?!\2)[^\n])+)\2/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const via = m[1];
    const line = lineOf(content, m.index);
    const words = m[3].trim().split(/\s+/);
    const cmd = words[0];
    const isScript = SCRIPT_EXT_RE.test(cmd);
    const primary = isScript ? cmd.replace(/^\.\//, '') : `cmd:${cmd}`;
    edges.push({ src_path: srcPath, dst_path: primary, edge_type: 'spawn', detail: { line, via } });
    const seen = new Set([primary]);
    // 首字面量内的后续词(execSync(`bash x.sh`) 场景)
    for (const w of words.slice(1)) {
      if (SCRIPT_EXT_RE.test(w)) {
        const p = w.replace(/^\.\//, '');
        if (!seen.has(p)) {
          seen.add(p);
          edges.push({ src_path: srcPath, dst_path: p, edge_type: 'spawn', detail: { line, via } });
        }
      }
    }
    // 同一行其余独立字面量脚本参数(spawn('bash', ['x.sh']) 场景)
    const lineEnd = content.indexOf('\n', m.index);
    const callLine = content.slice(m.index + m[0].length, lineEnd === -1 ? undefined : lineEnd);
    const argRe = /['"`]([^'"`\s]+\.(?:sh|mjs|cjs|py|js))['"`]/g;
    let a;
    while ((a = argRe.exec(callLine)) !== null) {
      const p = a[1].replace(/^\.\//, '');
      if (!seen.has(p)) {
        seen.add(p);
        edges.push({ src_path: srcPath, dst_path: p, edge_type: 'spawn', detail: { line, via } });
      }
    }
  }
  return edges;
}

export function extractHttpEdges(content, srcPath) {
  const edges = [];
  // 三种前导形态:完整 host、模板变量闭括号、引号直接开头
  const re = /(?:(?:localhost|127\.0\.0\.1):5221|\}|['"`])(\/api\/[^'"`\s]*)/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    let p = m[1].split('?')[0].split('${')[0];
    if (!p.startsWith('/api/')) continue;
    const line = lineOf(content, m.index);
    const key = `${p}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ src_path: srcPath, dst_path: p, edge_type: 'http', detail: { line } });
  }
  return edges;
}
