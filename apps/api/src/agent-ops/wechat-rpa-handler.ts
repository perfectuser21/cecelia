/**
 * wechat-rpa handler — Path 4 Sprint 1
 *
 * 调用一个 Python RPA 进程执行微信自动化动作。
 *
 * dryrun=true 时：不 spawn 真实 Python，立即返回 receipt（用于 CI / 单测）。
 * 正常模式：spawn Python 脚本，通过 stdin/stdout JSON 协议通信，30s 超时。
 *
 * Python 脚本路径由 WECHAT_RPA_PY_PATH 环境变量控制，
 * 默认 scripts/agents/wechat_rpa.py。
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

export interface RpaRequest {
  action_type: string;
  target?: string;
  content?: string;
  dryrun?: boolean;
  agent_id?: string;
}

export interface RpaReceipt {
  session_id: string;
  action_type: string;
  dryrun: boolean;
  status: 'ok' | 'error' | 'dryrun_receipt';
  payload?: unknown;
  error?: string;
}

const PYTHON_PATH = process.env.WECHAT_RPA_PY_PATH ?? 'scripts/agents/wechat_rpa.py';
const SPAWN_TIMEOUT_MS = 30_000;

export class UnsupportedRpaActionError extends Error {}

export async function spawnRpaHandler(req: RpaRequest): Promise<RpaReceipt> {
  const session_id = randomUUID();

  // dryrun — 不产生真实副作用，直接返回 receipt
  if (req.dryrun) {
    return {
      session_id,
      action_type: req.action_type,
      dryrun: true,
      status: 'dryrun_receipt',
      payload: {
        target: req.target ?? null,
        content: req.content ?? null,
        agent_id: req.agent_id ?? null,
      },
    };
  }

  const pythonBin = process.env.PYTHON_BIN ?? 'python3';
  const input = JSON.stringify({
    session_id,
    action_type: req.action_type,
    target: req.target ?? null,
    content: req.content ?? null,
    agent_id: req.agent_id ?? null,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [PYTHON_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`wechat-rpa timeout after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      let result: unknown;
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        reject(new Error(`wechat-rpa invalid JSON output (exit ${code}): ${stdout.slice(0, 200)}`));
        return;
      }
      const body = result !== null && typeof result === 'object'
        ? result as { ok?: unknown; error?: unknown; data?: { dryrun?: unknown } }
        : undefined;
      if (body?.ok === false && body.error === 'unsupported_action') {
        reject(new UnsupportedRpaActionError(`wechat-rpa action is not implemented: ${req.action_type}`));
        return;
      }
      if (code !== 0 || body?.ok !== true) {
        reject(new Error(`wechat-rpa failed (exit ${code}): ${typeof body?.error === 'string' ? body.error : stderr.trim()}`));
        return;
      }
      const dryrun = body.data?.dryrun === true;
      resolve({
        session_id,
        action_type: req.action_type,
        dryrun,
        status: dryrun ? 'dryrun_receipt' : 'ok',
        payload: result,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}
