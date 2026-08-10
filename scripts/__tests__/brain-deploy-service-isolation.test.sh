#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/scripts/brain-deploy.sh"
ROLLBACK_SCRIPT="$ROOT_DIR/scripts/brain-rollback.sh"

node --input-type=module - "$DEPLOY_SCRIPT" "$ROLLBACK_SCRIPT" <<'NODE'
import { readFileSync } from 'node:fs';

const lifecycleCommands = [];

for (const scriptPath of process.argv.slice(2)) {
  const lines = readFileSync(scriptPath, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trimStart().startsWith('docker compose')) continue;
    const commandLines = [lines[index]];
    while (commandLines.at(-1).trimEnd().endsWith('\\') && index + 1 < lines.length) {
      index += 1;
      commandLines.push(lines[index]);
    }
    const command = commandLines.join(' ').replaceAll('\\', '').replace(/\s+/g, ' ').trim();
    if (/\b(?:up -d|down|stop|restart|start|create|rm)\b/.test(command)) {
      lifecycleCommands.push({ scriptPath, command });
    }
  }
}

if (lifecycleCommands.length === 0) {
  console.error('FAIL: Brain 部署与回滚脚本中未找到 compose 生命周期命令');
  process.exit(1);
}

const unscoped = lifecycleCommands.filter(({ command }) => {
  if (/\bdown\b/.test(command)) return true;
  const match = command.match(/\b(?:up -d|stop|restart|start|create|rm(?:\s+-[a-z]+)*)\s+([^;&|]+)/);
  return !match || match[1].trim() !== 'node-brain';
});
if (unscoped.length > 0) {
  console.error(`FAIL: ${unscoped.length} 个 Brain 生命周期命令未严格限定为 node-brain`);
  for (const { scriptPath, command } of unscoped) console.error(`--- ${scriptPath}\n${command}`);
  process.exit(1);
}

console.log(`PASS: ${lifecycleCommands.length} 个 Brain compose 生命周期命令均只操作 node-brain`);
NODE
