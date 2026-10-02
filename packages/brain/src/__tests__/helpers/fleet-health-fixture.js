const GIB=1024**3;
export function completeReport(profile, overrides = {}, nowMs = Date.now()) {
  const policy = profile.version_policy;
  const report = {
    schema_version: 'fleet-node-health/v1',
    machine_id: profile.machine_id,
    observed_at: new Date(nowMs - 5_000).toISOString(),
    worker: {
      protocol_version: policy.worker_protocol,
      contract_version: policy.worker_contract,
      version: policy.worker,
    },
    runner: {
      version: policy.runner,
      image_digest: profile.runner_image_digest,
    },
    os: { version: policy.os },
    orbstack: { version: policy.orbstack },
    docker: {
      available: true,
      observed_at: new Date(nowMs - 4_000).toISOString(),
    },
    resources: {
      cpu_cores: 6,
      memory_bytes: 8 * GIB,
      disk_free_bytes: 40 * GIB,
      disk_used_percent: 85,
      cpu_pressure_percent: profile.resources.cpu_pressure_max_percent - 1,
      memory_pressure_percent: profile.resources.memory_pressure_max_percent - 1,
    },
    git: { available: true, version: policy.git },
    node: { available: true, version: policy.node },
    codex: { available: true, version: policy.codex },
    tailscale: { connected: true },
    callback: { reachable: true },
    time_sync: { synchronized: true },
    power: { sleep_disabled: true, auto_power_on: true },
    launchd: { loaded: true, domain: 'system', kind: 'LaunchDaemon' },
    worktree: { root_ready: true },
    container: { probe_succeeded: true },
    runtime_resources: {
      postgres: {
        available: true,
        image_digest: profile.runtime_resources.postgres.image_digest,
      },
    },
    drain: { active: false },
  };
  return merge(report, overrides);
}

export function merge(base, patch) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && output[key] && typeof output[key] === 'object') {
      output[key] = { ...output[key], ...value };
    } else {
      output[key] = value;
    }
  }
  return output;
}
