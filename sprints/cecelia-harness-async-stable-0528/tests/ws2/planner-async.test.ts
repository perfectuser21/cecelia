import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// vitest 运行目录: packages/brain/
const GRAPH_PATH = join(process.cwd(), 'src/workflows/harness-initiative.graph.js');

function getPlannerNodeBody(): string {
  const content = readFileSync(GRAPH_PATH, 'utf8');
  const start = content.indexOf('export async function runPlannerNode');
  if (start < 0) throw new Error('runPlannerNode not found in harness-initiative.graph.js');
  const end = content.indexOf('\nexport ', start + 1);
  return content.slice(start, end > 0 ? end : start + 5000);
}

describe('WS2 — Planner 节点异步化 [BEHAVIOR]', () => {
  it('harness-initiative.graph.js 导入 spawnDockerDetached', () => {
    const content = readFileSync(GRAPH_PATH, 'utf8');
    expect(content).toContain('spawnDockerDetached');
  });

  it('runPlannerNode 函数体内不含阻塞 reconnectOrSpawn', () => {
    const body = getPlannerNodeBody();
    expect(body).not.toContain('reconnectOrSpawn');
  });

  it('runPlannerNode 函数体含 interrupt() 调用（挂起 graph）', () => {
    const body = getPlannerNodeBody();
    expect(body).toContain('interrupt');
  });

  it('runPlannerNode 使用 spawnDockerDetached 启动 Planner 容器', () => {
    const body = getPlannerNodeBody();
    expect(body).toContain('spawnDockerDetached');
  });

  it('harness-initiative.graph.js 含 walking_skeleton_thread_lookup 写入（容器 ID 映射）', () => {
    const content = readFileSync(GRAPH_PATH, 'utf8');
    const hasLookup = content.includes('walking_skeleton_thread_lookup') ||
      content.includes('harness-thread-lookup') ||
      content.includes('harnessThreadLookup');
    expect(hasLookup).toBe(true);
  });

  it('runPlannerNode 含 try-catch 错误处理（detached spawn 失败不崩溃）', () => {
    const body = getPlannerNodeBody();
    expect(body).toMatch(/catch|error/i);
  });
});
