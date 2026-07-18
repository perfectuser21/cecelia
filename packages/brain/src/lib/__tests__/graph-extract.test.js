import { describe, it, expect } from 'vitest';
import { extractSpawnEdges, extractHttpEdges } from '../graph-extract.js';

describe('extractSpawnEdges', () => {
  it('外部命令 → cmd: 前缀', () => {
    const edges = extractSpawnEdges(`const p = spawn('docker', ['ps']);`, 'src/a.js');
    expect(edges).toEqual([
      { src_path: 'src/a.js', dst_path: 'cmd:docker', edge_type: 'spawn', detail: { line: 1, via: 'spawn' } },
    ]);
  });

  it('首参是脚本路径 → repo 路径(去 ./)', () => {
    const edges = extractSpawnEdges(`execFile('./scripts/deploy.sh', [], cb)`, 'src/b.js');
    expect(edges[0].dst_path).toBe('scripts/deploy.sh');
    expect(edges[0].detail.via).toBe('execFile');
  });

  it('bash + 同字面量内脚本参数 → 两条边(cmd:bash + 脚本)', () => {
    const edges = extractSpawnEdges('execSync(`bash scripts/scan/run-all-scans.sh`)', 'src/c.js');
    const dsts = edges.map((e) => e.dst_path).sort();
    expect(dsts).toEqual(['cmd:bash', 'scripts/scan/run-all-scans.sh']);
  });

  it('bash + 独立字面量脚本参数(spawn 数组形态)→ 两条边', () => {
    const edges = extractSpawnEdges(`spawn('bash', ['scripts/x.sh', '--flag'])`, 'src/d.js');
    const dsts = edges.map((e) => e.dst_path).sort();
    expect(dsts).toEqual(['cmd:bash', 'scripts/x.sh']);
  });

  it('多行内容行号正确', () => {
    const edges = extractSpawnEdges(`// x\n// y\nexecSync('git status')`, 'src/e.js');
    expect(edges[0].detail.line).toBe(3);
    expect(edges[0].dst_path).toBe('cmd:git');
  });

  it('无匹配 → []', () => {
    expect(extractSpawnEdges('const a = 1;', 'src/f.js')).toEqual([]);
  });

  it('双引号串内嵌单引号 → 不丢边', () => {
    const edges = extractSpawnEdges(`execSync("docker ps --filter 'name=cecelia' --format '{{.ID}}'")`, 'src/k.js');
    expect(edges[0].dst_path).toBe('cmd:docker');
  });

  it('反引号串内嵌双引号与模板变量 → 不丢边', () => {
    const edges = extractSpawnEdges('execSync(`git -C "${p}" worktree list --porcelain`)', 'src/l.js');
    expect(edges[0].dst_path).toBe('cmd:git');
  });
});

describe('extractHttpEdges', () => {
  it('localhost:5221 完整 URL → 路径名', () => {
    const edges = extractHttpEdges(`fetch('http://localhost:5221/api/brain/tasks?limit=5')`, 'src/g.js');
    expect(edges).toEqual([
      { src_path: 'src/g.js', dst_path: '/api/brain/tasks', edge_type: 'http', detail: { line: 1 } },
    ]);
  });

  it('模板变量前缀 `${BRAIN}/api/brain/...` → 命中', () => {
    const edges = extractHttpEdges('curl(`${BRAIN}/api/brain/harness/judge`)', 'src/h.js');
    expect(edges[0].dst_path).toBe('/api/brain/harness/judge');
  });

  it('引号直接开头的 /api/brain 路径 → 命中;路径中段模板变量截断后仍收', () => {
    const edges = extractHttpEdges('await get(`/api/brain/tasks/${id}/claim`)', 'src/i.js');
    expect(edges[0].dst_path).toBe('/api/brain/tasks/');
  });

  it('非 /api 路径与普通字符串 → []', () => {
    expect(extractHttpEdges(`fetch('/health'); const s='api/brain';`, 'src/j.js')).toEqual([]);
  });
});
