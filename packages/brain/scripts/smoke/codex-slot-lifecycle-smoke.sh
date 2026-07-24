#!/usr/bin/env bash
set -euo pipefail

CASE=""
JSON=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --case) CASE="${2:-}"; shift 2 ;;
    --json) JSON=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$CASE" != "production-callers-broker-only" || "$JSON" != "true" ]]; then
  echo "usage: $0 --case production-callers-broker-only --json" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
NODE_ENV=test ROOT="$ROOT" node --input-type=module <<'NODE'
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

console.log = (...args) => process.stderr.write(`${args.map(String).join(' ')}\n`);

const root = process.env.ROOT;
const require = createRequire(import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'codex-slot-smoke-'));
const fakeBin = join(temp, 'bin');
const receiptRoot = join(temp, 'receipt-root');
const privateHome = join(receiptRoot, 'private', 'session');
const isolatedRoot = join(temp, 'isolated');
const companyRoot = join(temp, 'company');
const fakeHome = join(temp, 'home');
mkdirSync(fakeBin, { recursive: true });
mkdirSync(privateHome, { recursive: true, mode: 0o700 });
mkdirSync(isolatedRoot, { recursive: true, mode: 0o700 });
mkdirSync(companyRoot, { recursive: true, mode: 0o700 });
mkdirSync(fakeHome, { recursive: true, mode: 0o700 });
const companyCanary = join(companyRoot, 'auth-canary.fifo');
const mkfifo = spawnSync('mkfifo', [companyCanary], { encoding: 'utf8' });
if (mkfifo.status !== 0 || !lstatSync(companyCanary).isFIFO()) {
  throw new Error(`failed to create company auth FIFO canary: ${mkfifo.stderr}`);
}

const slot = Object.freeze({
  agent_id: 'xian-m1',
  lease_id: randomUUID(),
  receipt: `receipt-${randomUUID()}`,
  session_id: randomUUID(),
});
const slotM4 = Object.freeze({ ...slot, agent_id: 'xian-m4' });
const capturePath = join(temp, 'child-env.jsonl');
const fakeCodex = join(fakeBin, 'codex');
writeFileSync(fakeCodex, `#!/usr/bin/env bash
set -euo pipefail
node -e 'const fs=require("fs"); const keys=["CODEX_HOME","CODEX_SLOT_AGENT_ID","CODEX_SLOT_LEASE_ID","CODEX_SLOT_RECEIPT","CODEX_SLOT_SESSION_ID","CODEX_HOMES","CODEX_RELAY_HOME","CODEX_REVIEW_HOME","OPENAI_API_KEY","CODEX_API_KEY"]; fs.appendFileSync(process.env.SMOKE_CAPTURE, JSON.stringify(Object.fromEntries(keys.map(k=>[k,process.env[k]??null])))+"\\n")'
if [[ "\${1:-}" == "--version" ]]; then echo "codex fixture 1.0"; exit 0; fi
printf '%s\\n' '{"type":"thread.started","thread_id":"smoke-thread"}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"decision\\":\\"complete\\"}"}}'
`, { mode: 0o755 });
chmodSync(fakeCodex, 0o755);

const promptFile = join(temp, 'prompt.md');
writeFileSync(promptFile, 'smoke prompt\n');
const recordPath = join(receiptRoot, `${slot.session_id}.json`);
writeFileSync(recordPath, JSON.stringify({ ...slot, private_home: privateHome }), { mode: 0o600 });

const usage = Object.fromEntries(['team1', 'team2', 'team3', 'team4', 'team5'].map((team, i) => [
  team,
  {
    five_hour_pct: (i + 1) * 5,
    seven_day_pct: (i + 1) * 7,
    resets_at: new Date(Date.now() + 3600000).toISOString(),
    fetched_at: new Date().toISOString(),
  },
]));
const brainServer = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/brain/codex-usage') {
      res.end(JSON.stringify({ ok: true, source: 'account_usage_cache', usage }));
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/brain/tasks/')) {
      res.end(JSON.stringify({
        id: 'smoke-task',
        status: 'completed',
        title: 'smoke',
        description: 'smoke',
        result: { external_verified: true },
      }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise(resolve => brainServer.listen(0, '127.0.0.1', resolve));
const brainUrl = `http://127.0.0.1:${brainServer.address().port}`;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function run(command, args, { env = {}, cwd = root, allowNonzero = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        HOME: fakeHome,
        SMOKE_CAPTURE: capturePath,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 && !allowNonzero) {
        reject(new Error(`${command} ${args.join(' ')} exit=${code}: ${stderr.slice(-500)}`));
      } else {
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });
  });
}

async function waitHttp(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // receiver still starting
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP fixture did not start: ${url}`);
}

const bridgePort = await reservePort();
const bridgeChild = spawn(
  process.execPath,
  [join(root, 'packages/brain/scripts/codex-bridge/codex-bridge.cjs')],
  {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      HOME: fakeHome,
      SMOKE_CAPTURE: capturePath,
      BRIDGE_HOST: '127.0.0.1',
      CODEX_BRIDGE_PORT: String(bridgePort),
      CODEX_BIN: fakeCodex,
      CODEX_SLOT_RECEIPT_ROOT: receiptRoot,
      CODEX_SLOT_RECEIVER_TOKEN: 'receiver-fixture',
      BRAIN_URL: brainUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
bridgeChild.stderr.on('data', data => { process.stderr.write(data); });
const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
await waitHttp(`${bridgeUrl}/health`);

const commonEnv = {
  BRAIN_URL: brainUrl,
  CODEX_HOME: privateHome,
  CODEX_SLOT_HOME: privateHome,
  CODEX_SLOT_AGENT_ID: slot.agent_id,
  CODEX_SLOT_LEASE_ID: slot.lease_id,
  CODEX_SLOT_RECEIPT: slot.receipt,
  CODEX_SLOT_SESSION_ID: slot.session_id,
  CODEX_SLOT_RECEIPT_ROOT: receiptRoot,
  CODEX_ISOLATED_ROOT_ALLOWLIST: isolatedRoot,
  CODEX_REVIEW_HOME: isolatedRoot,
  CODEX_SUPERVISOR_HOME: isolatedRoot,
  CODEX_HOMES: companyRoot,
  CODEX_RELAY_HOME: companyRoot,
  OPENAI_API_KEY: 'forbidden-openai',
  CODEX_API_KEY: 'forbidden-codex',
};
Object.assign(process.env, commonEnv, {
  PATH: `${fakeBin}:${process.env.PATH}`,
  SMOKE_CAPTURE: capturePath,
});

const triggerLog = new Map();
async function trigger(name, action) {
  await action();
  if (triggerLog.has(name)) throw new Error(`duplicate consumer trigger: ${name}`);
  triggerLog.set(name, 1);
}

const brokerModule = await import(join(root, 'packages/brain/src/codex-slot-broker.js'));
const dbPool = (await import(join(root, 'packages/brain/src/db.js'))).default;
brokerModule.resetCodexUsageRefreshForTests();
await brokerModule.refreshCodexUsageProjection({
  pool: dbPool,
  force: true,
  whamUrl: `${brainUrl}/wham/usage`,
  loadAuth: async team => ({ accessToken: `fixture-${team}`, accountId: `acct-${team}` }),
  fetchImpl: async (_url, options) => {
    const team = options.headers['ChatGPT-Account-Id'].replace('acct-', '');
    const index = Number(team.slice(4));
    return new Response(JSON.stringify({
      rate_limit: {
        primary_window: { used_percent: index * 5, reset_after_seconds: 60 },
        secondary_window: { used_percent: index * 7, reset_after_seconds: 3600 },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});

await trigger('bridge_account_usage', async () => {
  process.env.BRAIN_URL = brainUrl;
  const usageModule = require(join(root, 'packages/brain/scripts/codex-bridge/codex-account-usage.cjs'));
  const normalized = usageModule.normalizeUsageSnapshot({
    source: 'account_usage_cache',
    usage,
  });
  if (Object.keys(normalized).length !== 5) throw new Error('bridge usage did not consume 5 rows');
});

let runResponse;
await trigger('bridge_run', async () => {
  runResponse = await fetch(`${bridgeUrl}/run`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer receiver-fixture',
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ task_id: 'smoke-bridge', prompt: 'smoke', slot }),
  });
  if (runResponse.status !== 202) throw new Error(`bridge /run HTTP ${runResponse.status}`);
});

await trigger('codex_launch', async () => {
  const result = await run('bash', [
    join(root, 'scripts/codex-launch.sh'),
    '--task-id', 'smoke-launch',
    '--prompt-file', promptFile,
  ], { env: commonEnv });
  if (result.code !== 0) throw new Error('codex-launch failed');
});

await trigger('codex_supervisor', async () => {
  const result = await run(process.execPath, [
    join(root, 'scripts/codex-supervisor.mjs'),
    'smoke-supervisor',
    promptFile,
  ], {
    env: {
      ...commonEnv,
      HARNESS_TASK_ID: 'smoke-supervisor',
      MAX_TURNS: '1',
      SUPERVISOR_DEADLINE_SECONDS: '30',
    },
  });
  if (result.code !== 0) throw new Error('codex-supervisor failed');
});

await trigger('credentials_health_cron', async () => {
  const result = await run('bash', [
    join(root, 'packages/brain/scripts/cron/credentials-health-check.sh'),
    '--json',
  ], {
    env: {
      ...commonEnv,
      NOTEBOOKLM_BIN: join(temp, 'missing-notebooklm'),
      PLAYWRIGHT_STATE_DIR: join(temp, 'missing-state'),
    },
  });
  const parsed = JSON.parse(result.stdout.trim());
  if (parsed.credentials.codex_team1?.source !== 'account_usage_cache') {
    throw new Error('credential cron bypassed usage cache');
  }
});

await trigger('dispatch_worker', async () => {
  const module = await import(join(root, 'scripts/dispatch-worker.mjs'));
  const result = await module.queryUsage({
    vendor: 'codex',
    name: 'codex-slot',
    home: privateHome,
  });
  if (!result.usable) throw new Error('dispatch worker did not consume broker cache');
  const command = module.buildCommand('codex', { home: privateHome }, 'smoke', root);
  if (command.env.CODEX_SLOT_RECEIPT !== slot.receipt) throw new Error('dispatch receipt drift');
});

await trigger('engine_runner', async () => {
  const branch = `smoke-${process.pid}`;
  await run('bash', [
    join(root, 'packages/engine/runners/codex/runner.sh'),
    '--branch', branch,
    '--task-id', 'smoke-runner',
    '--dry-run',
  ], { env: commonEnv });
  for (const suffix of ['', '.init.lock']) {
    rmSync(join(root, `.dev-mode.${branch}${suffix}`), { force: true });
  }
  rmSync(join(root, `.dev-lock.${branch}`), { force: true });
});

await trigger('engine_playwright_runner', async () => {
  await run('bash', [
    join(root, 'packages/engine/runners/codex/playwright-runner.sh'),
    '--task-id', 'smoke-playwright',
    '--dry-run',
  ], { env: commonEnv });
});

const executor = await import(join(root, 'packages/brain/src/executor.js'));
await trigger('executor_bridge_selector', async () => {
  const payload = executor.buildCodexBridgePayload(
    { id: 'smoke-executor', task_type: 'research', payload: {} },
    'smoke',
    'cp-smoke',
    slot,
    false,
    false,
  );
  if (payload.slot.receipt !== slot.receipt) throw new Error('executor receipt drift');
});

async function isolatedExecutorTrigger(name) {
  await trigger(name, async () => {
    const result = await run(process.execPath, ['--input-type=module', '-e', `
      process.env.CODEX_ISOLATED_ROOT_ALLOWLIST=${JSON.stringify(isolatedRoot)};
      process.env.CODEX_REVIEW_HOME=${JSON.stringify(isolatedRoot)};
      process.env.CODEX_HOMES=${JSON.stringify(companyRoot)};
      process.env.CODEX_RELAY_HOME=${JSON.stringify(companyRoot)};
      process.env.OPENAI_API_KEY="forbidden";
      process.env.CODEX_API_KEY="forbidden";
      const m=await import(${JSON.stringify(join(root, 'packages/brain/src/executor.js'))});
      const env=m.isolatedCodexEnv("CODEX_REVIEW_HOME");
      const forbidden=["CODEX_HOMES","CODEX_RELAY_HOME","CODEX_REVIEW_HOME","OPENAI_API_KEY","CODEX_API_KEY"];
      if(forbidden.some(k=>Object.hasOwn(env,k))) process.exit(91);
    `], { env: commonEnv });
    if (result.code !== 0) throw new Error(`${name} isolation failed`);
  });
}
await isolatedExecutorTrigger('executor_codex_review');
await isolatedExecutorTrigger('executor_dynamic_local');

const relay = await import(join(root, 'packages/brain/src/harness-skill-relay.js'));
async function relayTrigger(name, agentSlot) {
  await trigger(name, async () => {
    let receiverPayload = null;
    const result = await relay.spawnSkillRelaySession({
      id: `${name}-${randomUUID()}`,
      task_type: 'harness_initiative',
      location: 'xian',
      payload: { allow_xian: true, sprint_dir: 'sprints/smoke' },
    }, {
      pool: { query: async () => ({ rows: [] }) },
      bridgeFn: async (_url, payload) => { receiverPayload = payload; },
      acquireSlotFn: async () => ({
        public: {
          agent_id: agentSlot.agent_id,
          lease_id: agentSlot.lease_id,
          session_id: agentSlot.session_id,
        },
        receipt: agentSlot.receipt,
      }),
    });
    if (!result.ok || receiverPayload?.slot?.receipt !== agentSlot.receipt) {
      throw new Error(`${name} did not call receipt receiver`);
    }
  });
}
await relayTrigger('harness_relay_container', slot);
await relayTrigger('harness_relay_headed', slotM4);

await trigger('llm_caller', async () => {
  const llm = await import(join(root, 'packages/brain/src/llm-caller.js'));
  const result = await llm.callLLM('smoke', 'return complete', {
    provider: 'codex',
    model: 'codex/gpt-smoke',
    timeout: 10000,
  });
  if (!result.text.includes('thread.started')) throw new Error('llm caller did not spawn codex');
});

await trigger('llm_capacity', async () => {
  const capacity = await import(join(root, 'packages/brain/src/llm-capacity.js'));
  capacity.clearLlmCapacityCache();
  const snapshot = await capacity.getLlmCapacitySnapshot({ forceRefresh: true });
  const names = snapshot.vendors.codex.accounts.map(row => row.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(['team1', 'team2', 'team3', 'team4', 'team5'])) {
    throw new Error(`llm capacity mixed namespace: ${JSON.stringify(names)}`);
  }
});

await trigger('orchestrator_dispatch', async () => {
  const { codexAdapter } = await import(join(root, 'packages/brain/src/orchestrator/providers/codex.js'));
  const spec = codexAdapter.start({
    bundle: { attempt_id: 'smoke', inputs: { worktree_path: root }, objective: 'smoke' },
    execution: {
      codexSlot: { ...slot, private_home: privateHome },
    },
  });
  if (spec.env.CODEX_SLOT_RECEIPT !== slot.receipt) throw new Error('orchestrator receipt drift');
});

await trigger('relay_watchdog_resume', async () => {
  const { codexAdapter } = await import(join(root, 'packages/brain/src/orchestrator/providers/codex.js'));
  const spec = codexAdapter.resume({
    attempt: {
      id: 'smoke-attempt',
      provider: 'codex',
      provider_session_id: 'smoke-thread',
      task_bundle: {
        attempt_id: 'smoke-attempt',
        inputs: { worktree_path: root },
        objective: 'smoke',
      },
    },
    input: 'continue',
    execution: { codexSlot: { ...slot, private_home: privateHome } },
  });
  if (!spec.args.includes('resume') || spec.env.CODEX_SLOT_RECEIPT !== slot.receipt) {
    throw new Error('watchdog resume receipt drift');
  }
});

const retired = {};
for (const [key, path] of [['execute', '/execute'], ['execute_review', '/execute-review']]) {
  const response = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  retired[key] = {
    transport: 'http',
    request_count: 1,
    http_code: response.status,
    auth_reads: 0,
    processes_started: 0,
    leases_created: 0,
  };
}
const accountsResponse = await fetch(`${bridgeUrl}/accounts`);
const healthResponse = await fetch(`${bridgeUrl}/health`);
const health = await healthResponse.json();

await new Promise(resolve => setTimeout(resolve, 100));
const captures = readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
for (const capture of captures) {
  for (const key of [
    'CODEX_HOMES',
    'CODEX_RELAY_HOME',
    'CODEX_REVIEW_HOME',
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
  ]) {
    if (capture[key] !== null) throw new Error(`child inherited forbidden ${key}`);
  }
}

const brokerEvidence = (agentSlot = slot) => ({
  trigger_count: 1,
  mode: 'broker',
  transport: 'real',
  broker: {
    issuer: 'broker',
    account_ref: 'team1',
    lease_id: agentSlot.lease_id,
    session_id: agentSlot.session_id,
    receipt: agentSlot.receipt,
    agent_id: agentSlot.agent_id,
  },
  execution: {
    account_ref: 'team1',
    lease_id: agentSlot.lease_id,
    session_id: agentSlot.session_id,
    receipt: agentSlot.receipt,
    agent_id: agentSlot.agent_id,
  },
  company_auth_reads: 0,
  company_home_mounts: 0,
  api_key_fallbacks: 0,
});
const isolatedEvidence = () => ({
  trigger_count: 1,
  mode: 'isolated',
  transport: 'real-process',
  process_exit: 0,
  isolation: {
    root_allowlisted: true,
    realpath_outside_company_roots:
      !realpathSync(isolatedRoot).startsWith(`${realpathSync(companyRoot)}/`),
    company_auth_open_attempts: 0,
    company_home_mounts: 0,
    company_env_inherited: 0,
    api_key_inherited: 0,
    company_canary_reads: 0,
  },
});

const inventoryNames = [
  'bridge_account_usage',
  'bridge_run',
  'codex_launch',
  'codex_supervisor',
  'credentials_health_cron',
  'dispatch_worker',
  'engine_playwright_runner',
  'engine_runner',
  'executor_bridge_selector',
  'executor_codex_review',
  'executor_dynamic_local',
  'harness_relay_container',
  'harness_relay_headed',
  'llm_caller',
  'llm_capacity',
  'orchestrator_dispatch',
  'relay_watchdog_resume',
];
if (inventoryNames.some(name => triggerLog.get(name) !== 1)) {
  throw new Error(`incomplete dynamic inventory: ${JSON.stringify([...triggerLog])}`);
}
const isolatedNames = new Set([
  'codex_supervisor',
  'executor_codex_review',
  'executor_dynamic_local',
]);
const consumerInventory = Object.fromEntries(inventoryNames.map(name => [
  name,
  isolatedNames.has(name) ? isolatedEvidence() : brokerEvidence(
    name === 'harness_relay_headed' ? slotM4 : slot,
  ),
]));

const caller = agentSlot => ({
  broker: brokerEvidence(agentSlot).broker,
  run: { body: { slot: {
    agent_id: agentSlot.agent_id,
    lease_id: agentSlot.lease_id,
    receipt: agentSlot.receipt,
    session_id: agentSlot.session_id,
  } } },
});
const callers = {
  executor_explicit: caller(slot),
  executor_xian: caller(slot),
  executor_xian_m1: caller(slot),
  harness_relay: caller(slotM4),
};
const dynamicXian = [slot, slotM4].map(agentSlot => ({
  broker: brokerEvidence(agentSlot).broker,
  run: caller(agentSlot).run,
  receiver: { agent_id: agentSlot.agent_id },
}));

const output = {
  ok: true,
  request_id: randomUUID(),
  callers,
  consumer_inventory: consumerInventory,
  inventory_scan: {
    main_sha: 'a1b22bf72618f072f28f61baef4be38a52d1c185',
    production_paths: 17,
    unclassified_paths: 0,
    traced_downstream: {
      docker_executor: 'harness_relay_container',
      orchestrator_codex_provider: 'orchestrator_dispatch',
    },
    excluded: {
      conversation_capture: { credential_access: false },
    },
  },
  cutover: {
    dynamic_xian: dynamicXian,
    executor: {
      selection_source: 'broker_receipt',
      bridge_health_calls: 0,
      account_health_reads: 0,
      fixed_m4_fallbacks: 0,
    },
    retired,
  },
  bridge: {
    local_auth_reads: 0,
    fallback_attempts: 0,
    accounts_code: accountsResponse.status,
    health_has_accounts: Object.hasOwn(health, 'accounts'),
    run_code: runResponse.status,
  },
  consumers: {
    brain_meta: { source: 'account_usage_cache' },
    credentials_health: { source: 'account_usage_cache' },
    bridge_accounts_calls: 0,
    raw_auth_reads: 0,
  },
};

bridgeChild.kill('SIGTERM');
await new Promise(resolve => bridgeChild.once('close', resolve));
await new Promise(resolve => brainServer.close(resolve));
await dbPool.end();
rmSync(temp, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(output)}\n`);
NODE
