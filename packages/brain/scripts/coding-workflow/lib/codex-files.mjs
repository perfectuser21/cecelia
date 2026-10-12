// 无 shell 的规格/评审活动：仅提供工作树内文件读取，无命令、写入或网络接口。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DENIED = /(^|\/)(?:\.git|node_modules|\.credentials|\.env(?:\.[^/]*)?)(\/|$)|\.(?:pem|key)$/;
const MAX_BYTES = 256 * 1024;
function inside(root, file) { return file === root || file.startsWith(`${root}${path.sep}`); }
function target(root, wanted = '.') {
  const file = path.resolve(root, wanted);
  if (!inside(root, file)) throw new Error('path_outside_worktree');
  if (DENIED.test(path.relative(root, file))) throw new Error('path_denied');
  const real = fs.realpathSync(file);
  if (!inside(root, real)) throw new Error('symlink_outside_worktree');
  if (DENIED.test(path.relative(root, real))) throw new Error('path_denied');
  return real;
}
export function fileTool(worktree, name, args = {}) {
  const root = fs.realpathSync(worktree);
  if (!['read_file', 'list_files'].includes(name)) throw new Error('unknown_tool');
  const file = target(root, args.path);
  if (name === 'read_file') {
    if (!fs.statSync(file).isFile()) throw new Error('not_a_file');
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('file_too_large');
    return fs.readFileSync(file, 'utf8');
  }
  const out = [];
  const walk = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= 2000) break;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isSymbolicLink() || DENIED.test(rel)) continue;
      out.push(rel + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory() && depth < 4) walk(full, depth + 1);
    }
  };
  walk(file, 0);
  return out.join('\n');
}
const tools = ['read_file', 'list_files'].map((name) => ({
  name, description: name === 'read_file' ? '读取工作树内一个文本文件（上限256KB）' : '列出工作树内目录（最多2000项、5层）',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}));
function serve(root) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    let req;
    try {
      req = JSON.parse(line);
      if (req.id === undefined) return;
      let result;
      if (req.method === 'initialize') result = { protocolVersion: req.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'coding-files-readonly', version: '1.0.0' } };
      else if (req.method === 'tools/list') result = { tools };
      else if (req.method === 'tools/call') result = { content: [{ type: 'text', text: fileTool(root, req.params?.name, req.params?.arguments) }] };
      else if (req.method === 'ping') result = {};
      else throw new Error('method_not_supported');
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: req.id, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32602, message: String(error.message) } })}\n`);
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve(process.argv[2]);
