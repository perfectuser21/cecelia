/**
 * harness-e2e-runner.js — 代码执行段封装（evaluateContractNode 职责分离）
 *
 * 职责：逐命令执行合同 E2E 脚本，采集 exit code / stdout / stderr / elapsedMs，
 * 落盘 execution-record.json（sprint 目录下）。
 *
 * LLM 裁读段读取 execution-record.json，不直接执行命令。
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const execFileDefault = promisify(execFileCb);

const CMD_TIMEOUT_MS = 60_000;

/**
 * 逐命令执行 E2E 脚本命令列表，采集执行结果，落盘 execution-record.json。
 *
 * @param {string[]} commands         要执行的 bash 命令列表
 * @param {object}   opts
 * @param {string}   opts.sprintDir   sprint 目录路径（execution-record.json 写入此处）
 * @param {string}   [opts.cwd]       工作目录
 * @param {object}   [opts.execFile]  测试注入（默认 promisify(execFileCb)）
 * @returns {Promise<{commands: Array, recordPath: string}>}
 */
export async function runE2eScriptCommands(commands, opts = {}) {
  const execFn = opts.execFile || execFileDefault;
  const cwd = opts.cwd || process.cwd();
  const results = [];

  for (const cmd of commands) {
    const start = Date.now();
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      const result = await execFn('bash', ['-c', cmd], {
        cwd,
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      stdout = String(result.stdout || '').slice(0, 4000);
      stderr = String(result.stderr || '').slice(0, 2000);
    } catch (err) {
      exitCode = typeof err.code === 'number' ? err.code : (err.killed ? -1 : 1);
      if (exitCode === 0) exitCode = 1;
      stdout = String(err.stdout || '').slice(0, 4000);
      stderr = (err.killed ? 'TIMEOUT' : String(err.stderr || err.message || '')).slice(0, 2000);
    }
    const elapsedMs = Date.now() - start;
    results.push({ cmd, exitCode, stdout, stderr, elapsedMs });
  }

  const record = { commands: results };

  // 落盘 execution-record.json
  let recordPath = null;
  if (opts.sprintDir) {
    recordPath = path.join(opts.sprintDir, 'execution-record.json');
    writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8');
  }

  return { commands: results, recordPath };
}

// 别名导出（测试文件兼容多个函数名）
export const runContractE2eCommands = runE2eScriptCommands;
export const runE2eCommands = runE2eScriptCommands;
