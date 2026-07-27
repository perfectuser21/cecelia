import { validateNodeProfile } from './node-profile.js';

const GIB = 1024 ** 3;
const MAX_REPORT_AGE_MS = 90_000;
const MAX_FUTURE_SKEW_MS = 30_000;
const MAX_REASONS = 32;

const REQUIRED_SECTIONS = [
  'worker',
  'runner',
  'os',
  'orbstack',
  'docker',
  'resources',
  'git',
  'node',
  'codex',
  'tailscale',
  'callback',
  'time_sync',
  'power',
  'launchd',
  'worktree',
  'container',
  'drain',
];

const REQUIRED_LEAVES = [
  'schema_version',
  'machine_id',
  'observed_at',
  'worker.protocol_version',
  'worker.contract_version',
  'worker.version',
  'runner.version',
  'runner.image_digest',
  'os.version',
  'orbstack.version',
  'docker.available',
  'docker.observed_at',
  'resources.cpu_cores',
  'resources.memory_bytes',
  'resources.disk_free_bytes',
  'resources.disk_used_percent',
  'resources.cpu_pressure_percent',
  'resources.memory_pressure_percent',
  'git.available',
  'git.version',
  'node.available',
  'node.version',
  'codex.available',
  'codex.version',
  'tailscale.connected',
  'callback.reachable',
  'time_sync.synchronized',
  'power.sleep_disabled',
  'power.auto_power_on',
  'launchd.loaded',
  'launchd.domain',
  'launchd.kind',
  'worktree.root_ready',
  'container.probe_succeeded',
  'drain.active',
];

const OBJECT_SECTIONS = REQUIRED_SECTIONS;

const BOOLEAN_FIELDS = [
  'docker.available',
  'git.available',
  'node.available',
  'codex.available',
  'tailscale.connected',
  'callback.reachable',
  'time_sync.synchronized',
  'power.sleep_disabled',
  'power.auto_power_on',
  'launchd.loaded',
  'worktree.root_ready',
  'container.probe_succeeded',
  'drain.active',
];

const STRING_FIELDS = [
  'schema_version',
  'machine_id',
  'observed_at',
  'worker.protocol_version',
  'worker.contract_version',
  'worker.version',
  'runner.version',
  'runner.image_digest',
  'os.version',
  'orbstack.version',
  'docker.observed_at',
  'git.version',
  'node.version',
  'codex.version',
  'launchd.domain',
  'launchd.kind',
];

const NUMBER_FIELDS = [
  'resources.cpu_cores',
  'resources.memory_bytes',
  'resources.disk_free_bytes',
  'resources.disk_used_percent',
  'resources.cpu_pressure_percent',
  'resources.memory_pressure_percent',
];

const VERSION_CHECKS = [
  ['worker.protocol_version', 'worker_protocol', 'worker_protocol_drift'],
  ['worker.contract_version', 'worker_contract', 'worker_contract_drift'],
  ['worker.version', 'worker', 'worker_version_drift'],
  ['runner.version', 'runner', 'runner_version_drift'],
  ['os.version', 'os', 'os_version_drift'],
  ['orbstack.version', 'orbstack', 'orbstack_version_drift'],
  ['git.version', 'git', 'git_version_drift'],
  ['node.version', 'node', 'node_version_drift'],
  ['codex.version', 'codex', 'codex_version_drift'],
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasPath(object, path) {
  let current = object;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return false;
    current = current[part];
  }
  return true;
}

function getPath(object, path) {
  let current = object;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function createReasonCollector() {
  const reasons = [];
  const codes = new Set();

  return {
    add(code, field, message) {
      if (reasons.length >= MAX_REASONS || codes.has(code)) return;
      codes.add(code);
      reasons.push({ code, field, message });
    },
    reasons,
  };
}

function resultFor(profile, report, reasons) {
  const admitted = reasons.length === 0;
  return {
    machine_id: typeof profile?.machine_id === 'string' ? profile.machine_id : null,
    state: admitted ? 'base_admitted' : 'draining',
    base_admitted: admitted,
    dispatch_ready: admitted,
    observed_at: typeof report?.observed_at === 'string'
      && report.observed_at.length <= 40
      ? report.observed_at
      : null,
    reasons,
  };
}

function addInvalid(collector, invalidFields, field) {
  invalidFields.add(field);
  collector.add('invalid_evidence', field, 'Health evidence has an invalid value or type.');
}

function isUsable(invalidFields, report, field) {
  return hasPath(report, field) && !invalidFields.has(field);
}

export function evaluateBaseAdmission(report, options = {}) {
  const profile = isRecord(options) ? options.profile : null;
  const nowMs = isRecord(options) ? options.nowMs : undefined;
  const collector = createReasonCollector();
  const { reasons } = collector;

  if (report === null || report === undefined) {
    collector.add('health_report_missing', 'report', 'Fleet node health report is required.');
    return resultFor(profile, report, reasons);
  }
  if (!isRecord(report)) {
    collector.add('health_report_malformed', 'report', 'Fleet node health report must be an object.');
    return resultFor(profile, report, reasons);
  }
  if (!validateNodeProfile(profile)) {
    collector.add(
      'admission_profile_invalid',
      'profile',
      'A complete Fleet NodeProfile is required for admission.',
    );
  }
  if (!Number.isFinite(nowMs)) {
    collector.add(
      'admission_time_invalid',
      'nowMs',
      'A finite admission evaluation time is required.',
    );
  }

  for (const path of [...REQUIRED_SECTIONS, ...REQUIRED_LEAVES]) {
    if (!hasPath(report, path)) {
      collector.add(
        'required_evidence_missing',
        path,
        'Required fleet node health evidence is missing.',
      );
    }
  }

  const invalidFields = new Set();

  for (const section of OBJECT_SECTIONS) {
    if (hasPath(report, section) && !isRecord(report[section])) {
      addInvalid(collector, invalidFields, section);
    }
  }
  for (const field of STRING_FIELDS) {
    if (hasPath(report, field)) {
      const value = getPath(report, field);
      if (typeof value !== 'string' || value.length === 0) {
        addInvalid(collector, invalidFields, field);
      }
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    if (hasPath(report, field) && typeof getPath(report, field) !== 'boolean') {
      addInvalid(collector, invalidFields, field);
    }
  }
  for (const field of NUMBER_FIELDS) {
    if (hasPath(report, field)) {
      const value = getPath(report, field);
      if (!Number.isFinite(value) || value < 0) {
        addInvalid(collector, invalidFields, field);
      }
    }
  }

  for (const field of [
    'resources.disk_used_percent',
    'resources.cpu_pressure_percent',
    'resources.memory_pressure_percent',
  ]) {
    if (isUsable(invalidFields, report, field) && getPath(report, field) > 100) {
      addInvalid(collector, invalidFields, field);
    }
  }

  let observedAtMs;
  if (isUsable(invalidFields, report, 'observed_at')) {
    observedAtMs = Date.parse(report.observed_at);
    if (!Number.isFinite(observedAtMs)) {
      addInvalid(collector, invalidFields, 'observed_at');
    }
  }

  let dockerObservedAtMs;
  if (isUsable(invalidFields, report, 'docker.observed_at')) {
    dockerObservedAtMs = Date.parse(report.docker.observed_at);
    if (!Number.isFinite(dockerObservedAtMs)) {
      addInvalid(collector, invalidFields, 'docker.observed_at');
    }
  }

  if (isUsable(invalidFields, report, 'schema_version')
    && report.schema_version !== 'fleet-node-health/v1') {
    addInvalid(collector, invalidFields, 'schema_version');
  }

  if (isUsable(invalidFields, report, 'machine_id')
    && typeof profile?.machine_id === 'string'
    && report.machine_id !== profile.machine_id) {
    collector.add(
      'machine_identity_mismatch',
      'machine_id',
      'Reported machine identity does not match the selected profile.',
    );
  }

  if (Number.isFinite(nowMs) && Number.isFinite(observedAtMs)) {
    if (nowMs - observedAtMs > MAX_REPORT_AGE_MS) {
      collector.add(
        'health_report_stale',
        'observed_at',
        'Fleet node health report is older than the admission freshness window.',
      );
    } else if (observedAtMs - nowMs > MAX_FUTURE_SKEW_MS) {
      collector.add(
        'health_report_clock_skew',
        'observed_at',
        'Fleet node health report is too far in the future.',
      );
    }
  }

  if (Number.isFinite(nowMs) && Number.isFinite(dockerObservedAtMs)) {
    if (nowMs - dockerObservedAtMs > MAX_REPORT_AGE_MS) {
      collector.add(
        'docker_observation_stale',
        'docker.observed_at',
        'Docker evidence is older than the admission freshness window.',
      );
    } else if (dockerObservedAtMs - nowMs > MAX_FUTURE_SKEW_MS) {
      collector.add(
        'docker_observation_clock_skew',
        'docker.observed_at',
        'Docker evidence is too far in the future.',
      );
    }
  }

  if (isRecord(profile?.version_policy)) {
    for (const [field, policyKey, code] of VERSION_CHECKS) {
      if (isUsable(invalidFields, report, field)
        && getPath(report, field) !== profile.version_policy[policyKey]) {
        collector.add(code, field, 'Reported software version does not match the node policy.');
      }
    }
  }
  if (isUsable(invalidFields, report, 'runner.image_digest')
    && typeof profile?.runner_image_digest === 'string'
    && report.runner.image_digest !== profile.runner_image_digest) {
    collector.add(
      'runner_digest_drift',
      'runner.image_digest',
      'Runner image digest does not match the pinned node policy.',
    );
  }

  const requiredTrue = [
    ['docker.available', 'docker_unavailable', 'Docker is unavailable on the fleet node.'],
    ['git.available', 'git_unavailable', 'Git is unavailable on the fleet node.'],
    ['node.available', 'node_unavailable', 'Node.js is unavailable on the fleet node.'],
    ['codex.available', 'codex_unavailable', 'Codex is unavailable on the fleet node.'],
    ['tailscale.connected', 'tailscale_disconnected', 'Tailscale is disconnected on the fleet node.'],
    ['callback.reachable', 'callback_unreachable', 'The fleet callback endpoint is unreachable.'],
    ['time_sync.synchronized', 'time_unsynchronized', 'Fleet node time synchronization is unhealthy.'],
    ['power.sleep_disabled', 'sleep_not_disabled', 'Fleet node sleep is not disabled.'],
    ['power.auto_power_on', 'auto_power_off', 'Automatic power-on is not enabled.'],
    ['launchd.loaded', 'launchd_unloaded', 'Fleet Worker LaunchDaemon is not loaded.'],
    ['worktree.root_ready', 'worktree_unavailable', 'Fleet worktree root is not ready.'],
    ['container.probe_succeeded', 'container_probe_failed', 'Fleet container probe did not succeed.'],
  ];
  for (const [field, code, message] of requiredTrue) {
    if (isUsable(invalidFields, report, field) && getPath(report, field) === false) {
      collector.add(code, field, message);
    }
  }

  if (isUsable(invalidFields, report, 'drain.active') && report.drain.active === true) {
    collector.add('node_drained', 'drain.active', 'Fleet node has an active drain marker.');
  }

  if (isRecord(profile?.resources)) {
    const resourceChecks = [
      ['resources.cpu_cores', profile.resources.cpu_cores, 'cpu_below_floor', (value, limit) => value < limit],
      ['resources.memory_bytes', profile.resources.memory_gib * GIB, 'memory_below_floor', (value, limit) => value < limit],
      ['resources.disk_free_bytes', profile.resources.disk_min_free_gib * GIB, 'disk_free_below_floor', (value, limit) => value < limit],
      ['resources.disk_used_percent', profile.resources.disk_max_used_percent, 'disk_usage_above_ceiling', (value, limit) => value > limit],
      ['resources.cpu_pressure_percent', profile.resources.cpu_pressure_max_percent, 'cpu_pressure_above_ceiling', (value, limit) => value > limit],
      ['resources.memory_pressure_percent', profile.resources.memory_pressure_max_percent, 'memory_pressure_above_ceiling', (value, limit) => value > limit],
    ];
    for (const [field, limit, code, fails] of resourceChecks) {
      if (Number.isFinite(limit) && isUsable(invalidFields, report, field)
        && fails(getPath(report, field), limit)) {
        collector.add(code, field, 'Reported resources do not satisfy the Fleet NodeProfile limit.');
      }
    }
  }

  if (isUsable(invalidFields, report, 'launchd.domain')
    && isRecord(profile?.launchd)
    && report.launchd.domain !== profile.launchd.domain) {
    collector.add(
      'launchd_not_system',
      'launchd.domain',
      'Fleet Worker must run in the system launchd domain.',
    );
  }
  if (isUsable(invalidFields, report, 'launchd.kind')
    && isRecord(profile?.launchd)
    && report.launchd.kind !== profile.launchd.kind) {
    collector.add(
      'launchd_not_daemon',
      'launchd.kind',
      'Fleet Worker must run as a LaunchDaemon.',
    );
  }

  return resultFor(profile, report, reasons);
}
