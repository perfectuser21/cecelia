#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_SCRIPT="$ROOT_DIR/scripts/brain-deploy.sh"
ROLLBACK_SCRIPT="$ROOT_DIR/scripts/brain-rollback.sh"

node --input-type=module - "$DEPLOY_SCRIPT" "$ROLLBACK_SCRIPT" <<'NODE'
import { readFileSync } from 'node:fs';

function analyzeLifecycle(command) {
  const composeMatch = command.match(/\bdocker\s+compose\b/);
  if (!composeMatch) return null;

  const invocationPrefix = command.slice(0, composeMatch.index);
  const validPrefix = /^\s*(?:if\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*$/;
  if (!validPrefix.test(invocationPrefix)) return null;

  const composeTail = command.slice(composeMatch.index + composeMatch[0].length);
  const actionMatch = composeTail.match(/(?:^|\s)(up|down|stop|restart|start|create|rm|kill|pause|unpause)(?=\s|$)/);
  if (!actionMatch) return null;

  const action = actionMatch[1];
  let serviceTail = composeTail.slice(actionMatch.index + actionMatch[0].length);
  const boundary = serviceTail.search(/\s*(?:&&|\|\||;|(?:\d*|&)?>|<)/);
  if (boundary >= 0) serviceTail = serviceTail.slice(0, boundary);

  const words = serviceTail.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? [];
  const services = words
    .filter(word => !word.startsWith('-'))
    .map(word => word.replace(/^(['"])(.*)\1$/, '$2'));

  return {
    action,
    services,
    unsafe: action === 'down' || services.length !== 1 || services[0] !== 'node-brain',
  };
}

const fixtures = [
  ['docker compose -f compose.yml up -d node-brain', false],
  ['if docker compose -f compose.yml up --detach node-brain; then', false],
  ['BRAIN_VERSION=x docker compose -f compose.yml stop node-brain >/dev/null 2>&1', false],
  ['docker compose -f compose.yml restart node-brain && echo ok', false],
  ['if docker compose -f compose.yml up -d frontend; then', true],
  ['BRAIN_VERSION=x docker compose -f compose.yml up --detach frontend', true],
  ['docker compose -f compose.yml up -d node-brain frontend', true],
  ['docker compose -f compose.yml down', true],
  ['docker compose -f compose.yml kill frontend', true],
  ['docker compose -f compose.yml pause node-brain frontend', true],
  ['docker compose -f compose.yml unpause node-brain', false],
];

for (const [command, expectedUnsafe] of fixtures) {
  const result = analyzeLifecycle(command);
  if (!result || result.unsafe !== expectedUnsafe) {
    console.error(`FAIL: 守卫自测不符合预期：${command}`);
    process.exit(1);
  }
}

const lifecycleCommands = [];

for (const scriptPath of process.argv.slice(2)) {
  const lines = readFileSync(scriptPath, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trimStart().startsWith('#') || !/\bdocker\s+compose\b/.test(lines[index])) continue;
    const commandLines = [lines[index]];
    while (commandLines.at(-1).trimEnd().endsWith('\\') && index + 1 < lines.length) {
      index += 1;
      commandLines.push(lines[index]);
    }
    const command = commandLines.join(' ').replaceAll('\\', '').replace(/\s+/g, ' ').trim();
    const analysis = analyzeLifecycle(command);
    if (analysis) lifecycleCommands.push({ scriptPath, command, analysis });
  }
}

if (lifecycleCommands.length === 0) {
  console.error('FAIL: Brain 部署与回滚脚本中未找到 compose 生命周期命令');
  process.exit(1);
}

const unscoped = lifecycleCommands.filter(({ analysis }) => analysis.unsafe);
if (unscoped.length > 0) {
  console.error(`FAIL: ${unscoped.length} 个 Brain 生命周期命令未严格限定为 node-brain`);
  for (const { scriptPath, command } of unscoped) console.error(`--- ${scriptPath}\n${command}`);
  process.exit(1);
}

console.log(`PASS: ${lifecycleCommands.length} 个 Brain compose 生命周期命令均只操作 node-brain`);
NODE
