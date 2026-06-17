/**
 * live-container.js — 活容器探测（仅 node 内建依赖，可在无 brain node_modules 的 CI 环境跑）。
 *
 * 用于 evaluate 节点重入幂等：LangGraph interrupt() resume 会让节点从头重跑，spawn 在 interrupt 之前
 * → 每次 resume 重起一个 evaluator 容器。spawn 前用本函数查同 (task, fix_round) 是否已有活容器，
 * 有则复用、跳过重 spawn。刻意不依赖 db/langgraph 等重模块，方便 DoD BEHAVIOR 在 engine-tests job 直接 node 跑。
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileDefault = promisify(execFileCb);

// findLiveEvaluateContainer — 查同前缀的活容器（docker ps name 前缀过滤）。
// containerId 形如 harness-evaluate-<safeId>-r<round>-<rand>；前缀对 (task, fix_round) 确定。
// `docker ps --filter name=<prefix>` 命中 = 已有活容器（detached 非 --rm，跑完前可见）。
// 返回首个活容器名供复用；无活容器 → null。docker 不可用时由 caller catch（fail-open，正常 spawn）。
export async function findLiveEvaluateContainer(namePrefix, deps = {}) {
  const execFn = deps.execFile || execFileDefault;
  const { stdout } = await execFn(
    'docker', ['ps', '--filter', `name=${namePrefix}`, '--format', '{{.Names}}'],
    { timeout: 10_000 }
  );
  const names = String(stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((n) => n.startsWith(namePrefix));
  return names.length ? names[0] : null;
}
