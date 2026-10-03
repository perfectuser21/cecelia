'use strict';
const { projectGpuObservation } = require('./gpu-observation.cjs');
const { projectLinuxObservation } = require('./linux-resource-probe.cjs');
const { projectClockDiagnostic } = require('./time-sync-observation.cjs');
const MAX_STRING_LENGTH = 1_024;

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

function projectHealth(report, { sampleOrigin } = {}) {
  const source = report && typeof report === 'object' && !Array.isArray(report)
    ? report
    : {};
  return {
    ...(source.gpu ? {gpu: {schema_version: 'fleet-gpu-observation/v1', scope: 'host', ...projectGpuObservation(source.gpu)}} : {}),
    ...(source.linux_observation ? { linux_observation: projectLinuxObservation(source.linux_observation) } : {}),
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
      ...(source.time_sync?.diagnostic && typeof source.time_sync.diagnostic === 'object'
        && !Array.isArray(source.time_sync.diagnostic)
        ? { diagnostic: projectClockDiagnostic(source.time_sync.diagnostic, sampleOrigin) } : {}),
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
    runtime_resources: {
      postgres: {
        available: safeBoolean(source.runtime_resources?.postgres?.available),
        image_digest: safeString(
          source.runtime_resources?.postgres?.image_digest,
          'unconfigured',
        ),
      },
    },
    drain: {
      active: source.drain?.active !== false,
    },
  };
}

module.exports = { projectHealth, safeString, safeBoolean, safeNumber };
