#!/usr/bin/env node
'use strict';

const { Buffer } = require('node:buffer');
const http = require('node:http');
const process = require('node:process');
const { probeFleetWorkerHealth } = require('./node-probe.cjs');

const MAX_STRING_LENGTH = 1_024;
const MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5_231;

function safeString(value, fallback = 'unavailable') {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  let output = value.slice(0, MAX_STRING_LENGTH);
  if (/account|allowlist|authori[sz]ation|auth|token|prompt|credential/i.test(output)) {
    output = 'redacted';
  }
  output = output.replace(
    /\/(?:Users|private|tmp|var\/folders)\/[^\s"',}]*/g,
    '[redacted-path]',
  );
  return output || fallback;
}

function safeBoolean(value) {
  return value === true;
}

function safeNumber(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, maximum)
    : fallback;
}

function projectHealth(report) {
  const source = report && typeof report === 'object' && !Array.isArray(report)
    ? report
    : {};
  return {
    schema_version: safeString(source.schema_version, 'fleet-node-health/v1'),
    machine_id: safeString(source.machine_id, 'unconfigured'),
    observed_at: safeString(source.observed_at, '1970-01-01T00:00:00.000Z'),
    worker: {
      protocol_version: safeString(source.worker?.protocol_version),
      contract_version: safeString(source.worker?.contract_version),
      version: safeString(source.worker?.version),
    },
    runner: {
      version: safeString(source.runner?.version),
      image_digest: safeString(source.runner?.image_digest, 'unconfigured'),
    },
    os: {
      version: safeString(source.os?.version),
    },
    orbstack: {
      version: safeString(source.orbstack?.version),
    },
    docker: {
      available: safeBoolean(source.docker?.available),
      observed_at: safeString(
        source.docker?.observed_at,
        '1970-01-01T00:00:00.000Z',
      ),
    },
    resources: {
      cpu_cores: safeNumber(source.resources?.cpu_cores),
      memory_bytes: safeNumber(source.resources?.memory_bytes),
      disk_free_bytes: safeNumber(source.resources?.disk_free_bytes),
      disk_used_percent: safeNumber(source.resources?.disk_used_percent, 100, 100),
      cpu_pressure_percent: safeNumber(
        source.resources?.cpu_pressure_percent,
        100,
        100,
      ),
      memory_pressure_percent: safeNumber(
        source.resources?.memory_pressure_percent,
        100,
        100,
      ),
    },
    git: {
      available: safeBoolean(source.git?.available),
      version: safeString(source.git?.version),
    },
    node: {
      available: safeBoolean(source.node?.available),
      version: safeString(source.node?.version),
    },
    codex: {
      available: safeBoolean(source.codex?.available),
      version: safeString(source.codex?.version),
    },
    tailscale: {
      connected: safeBoolean(source.tailscale?.connected),
    },
    callback: {
      reachable: safeBoolean(source.callback?.reachable),
    },
    time_sync: {
      synchronized: safeBoolean(source.time_sync?.synchronized),
    },
    power: {
      sleep_disabled: safeBoolean(source.power?.sleep_disabled),
      auto_power_on: safeBoolean(source.power?.auto_power_on),
    },
    launchd: {
      loaded: safeBoolean(source.launchd?.loaded),
      domain: safeString(source.launchd?.domain, 'system'),
      kind: safeString(source.launchd?.kind, 'LaunchDaemon'),
    },
    worktree: {
      root_ready: safeBoolean(source.worktree?.root_ready),
    },
    container: {
      probe_succeeded: safeBoolean(source.container?.probe_succeeded),
    },
    drain: {
      active: source.drain?.active !== false,
    },
  };
}

function serializeBounded(value) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body, 'utf8') <= MAX_RESPONSE_BYTES) return body;
  return '{"error":"health_response_too_large"}';
}

function writeJson(response, statusCode, value) {
  const body = serializeBounded(value);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body, 'utf8'),
  });
  response.end(body);
}

function createFleetWorkerServer(options = {}) {
  const probeHealth = typeof options.probeHealth === 'function'
    ? options.probeHealth
    : () => probeFleetWorkerHealth(options);
  let probeInFlight = false;

  return http.createServer(async (request, response) => {
    if (request.url !== '/health') {
      writeJson(response, 404, { error: 'not_found' });
      return;
    }
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    if (probeInFlight) {
      writeJson(response, 503, { error: 'health_probe_busy' });
      return;
    }

    probeInFlight = true;
    try {
      const health = await probeHealth();
      writeJson(response, 200, projectHealth(health));
    } catch {
      writeJson(response, 503, { error: 'health_probe_failed' });
    } finally {
      probeInFlight = false;
    }
  });
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535
    ? port
    : DEFAULT_PORT;
}

function main(env = process.env) {
  const host = safeString(env.CECELIA_FLEET_WORKER_HOST, DEFAULT_HOST);
  const port = parsePort(env.CECELIA_FLEET_WORKER_PORT);
  const server = createFleetWorkerServer({
    env,
    machineId: env.CECELIA_MACHINE_ID,
    runnerImageDigest: env.CECELIA_RUNNER_DIGEST,
    repoRoot: env.CECELIA_REPO_ROOT,
    drainMarkerPath: env.CECELIA_DRAIN_MARKER,
    callbackUrl: env.CECELIA_CALLBACK_URL,
  });
  server.listen(port, host);
  return server;
}

if (require.main === module) {
  main();
}

module.exports = {
  createFleetWorkerServer,
};
