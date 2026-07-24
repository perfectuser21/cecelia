#!/usr/bin/env node

import { readFileSync, realpathSync, statSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG = '/etc/cecelia/codex-slot/agents.json';
const AGENT_IDS = new Set(['xian-m1', 'xian-m4']);

function fail(message, exitCode = 78) {
  process.stderr.write(`codex-slot-agent: ${message}\n`);
  process.exit(exitCode);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function validateAgentConfig(config) {
  if (!exactKeys(config, ['agents', 'schema_version'])
      || config.schema_version !== 1
      || !Array.isArray(config.agents)
      || config.agents.length !== 2) {
    throw new Error('config must contain exactly two schema v1 agents');
  }

  const seen = new Set();
  for (const agent of config.agents) {
    if (!exactKeys(agent, [
      'agent_id',
      'fleet_id',
      'machine_registry_name',
      'mmv',
      'root_attested',
    ])
        || !AGENT_IDS.has(agent.agent_id)
        || seen.has(agent.agent_id)
        || typeof agent.machine_registry_name !== 'string'
        || agent.machine_registry_name.length < 1
        || typeof agent.fleet_id !== 'string'
        || agent.fleet_id.length < 1
        || agent.root_attested !== true
        || !exactKeys(agent.mmv, ['allowed_ips', 'stable_node_id'])
        || typeof agent.mmv.stable_node_id !== 'string'
        || agent.mmv.stable_node_id.length < 1
        || !Array.isArray(agent.mmv.allowed_ips)
        || agent.mmv.allowed_ips.length < 1
        || !agent.mmv.allowed_ips.every(ip => typeof ip === 'string' && ip.length > 0)) {
      throw new Error('agent mapping is incomplete or invalid');
    }
    seen.add(agent.agent_id);
  }
  return config;
}

export function loadRootAgentConfig(configPath, { allowUnprivileged = false } = {}) {
  const stat = statSync(configPath);
  if (!stat.isFile()) throw new Error('config is not a regular file');
  if (!allowUnprivileged && stat.uid !== 0) throw new Error('config must be root-owned');
  if ((stat.mode & 0o022) !== 0) throw new Error('config must not be group/world writable');
  return validateAgentConfig(JSON.parse(readFileSync(configPath, 'utf8')));
}

export function resolveAgentAttestation(config, agentId) {
  const agent = config.agents.find(candidate => candidate.agent_id === agentId);
  if (!agent) throw new Error('agent identity is not mapped');
  return {
    agent_id: agent.agent_id,
    fleet_id: agent.fleet_id,
    machine_registry_name: agent.machine_registry_name,
    mmv: {
      allowed_ips: [...agent.mmv.allowed_ips],
      stable_node_id: agent.mmv.stable_node_id,
    },
    root_attested: true,
  };
}

function parseArgs(argv) {
  const result = {
    agentId: process.env.CODEX_SLOT_AGENT_ID || '',
    command: 'attest',
    configPath: process.env.CODEX_SLOT_CONFIG || DEFAULT_CONFIG,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--agent-id') result.agentId = argv[++index] || '';
    else if (value === '--config') result.configPath = argv[++index] || '';
    else if (value === 'attest') result.command = value;
    else fail(`unknown argument: ${value}`, 64);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!AGENT_IDS.has(args.agentId)) fail('CODEX_SLOT_AGENT_ID must be xian-m1 or xian-m4');
  try {
    const config = loadRootAgentConfig(args.configPath, {
      allowUnprivileged: process.env.CODEX_SLOT_ALLOW_UNPRIVILEGED_CONFIG === '1',
    });
    const attestation = resolveAgentAttestation(config, args.agentId);
    process.stdout.write(`${JSON.stringify({ ok: true, attestation })}\n`);
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1]
    && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main();
}
