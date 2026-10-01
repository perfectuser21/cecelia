'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Brain admission and Worker cgroups consume this single policy. Never read limits from task payloads.
const ROLE_WEIGHTS = Object.freeze({ commander:1, planner:1, reviewer:1, proposer:2,
  generator:4, evaluator:4, judge:4, reporter:1, publisher:1 });
const BASE_SLOT = Object.freeze({ cpus:0.5, memoryBytes:1024**3, pidsLimit:128 });
const POSTGRES = Object.freeze({ cpus:0.25, memoryBytes:256*1024**2, pidsLimit:32 });
function loadNodeProfile(workerId) {
  const adjacent = path.join(__dirname, 'fleet-node-profiles.json');
  const filename = fs.existsSync(adjacent) ? adjacent : path.join(__dirname, '../../config/fleet-node-profiles.json');
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')).profiles.find(profile => profile.machine_id === workerId); }
  catch { throw new Error('attempt_resource_profile_unavailable'); }
}
function resolveAttemptResourcePlan({ workerId, role, postgres = false } = {}) {
  const profile = loadNodeProfile(workerId);
  if (!profile || !Number.isInteger(profile.capacity) || profile.capacity <= 0
      || !Number.isFinite(profile.resources?.cpu_cores) || profile.resources.cpu_cores <= 0
      || !Number.isFinite(profile.resources?.memory_gib) || profile.resources.memory_gib <= 0) {
    throw new Error('attempt_resource_profile_unavailable');
  }
  if (!Object.hasOwn(ROLE_WEIGHTS, role)) throw new Error('attempt_resource_role_unavailable');
  if (typeof postgres !== 'boolean') throw new Error('attempt_resource_requirements_invalid');
  const weight = ROLE_WEIGHTS[role];
  const total = Object.freeze(Object.fromEntries(Object.entries(BASE_SLOT).map(([key, value]) => [key, value * weight])));
  const runner = Object.freeze(Object.fromEntries(Object.entries(total).map(([key, value]) => [key, value - (postgres ? POSTGRES[key] : 0)])));
  return Object.freeze({ policy_version: 1, role, weight, total, runner, postgres: postgres ? POSTGRES : null });
}
function dockerLimitArgs(limits) {
  if (!limits || !Number.isFinite(limits.cpus) || limits.cpus <= 0
      || !Number.isSafeInteger(limits.memoryBytes) || limits.memoryBytes < 6*1024**2
      || !Number.isSafeInteger(limits.pidsLimit) || limits.pidsLimit <= 0) throw new Error('attempt_resource_limits_invalid');
  return ['--cpus', String(limits.cpus), '--memory', String(limits.memoryBytes),
    '--memory-swap', String(limits.memoryBytes), '--pids-limit', String(limits.pidsLimit)];
}
module.exports = { ROLE_WEIGHTS, BASE_SLOT, resolveAttemptResourcePlan, dockerLimitArgs };
