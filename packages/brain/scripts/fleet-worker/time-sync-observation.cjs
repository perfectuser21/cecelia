'use strict';

const CATEGORIES = new Set(['passed', 'command_exit', 'command_not_found',
  'command_permission_denied', 'command_buffer_limit', 'command_terminated',
  'command_failed', 'offset_unparseable', 'offset_outside_limit']);
const PARSE_STATUSES = new Set(['within_policy', 'outside_policy', 'not_parseable', 'not_evaluated']);
const SIGNALS = new Set(['SIGTERM', 'SIGKILL']);
const SAMPLE_ORIGINS = new Set(['fresh_probe', 'cache_hit', 'shared_inflight']);

function projectClockDiagnostic(value, sampleOrigin) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, allowed] of [['category', CATEGORIES], ['parse_status', PARSE_STATUSES], ['signal', SIGNALS]]) {
    if (allowed.has(source[key])) result[key] = source[key];
  }
  for (const [key, maximum, integer] of [
    ['exit_code', 255, true], ['configured_timeout_ms', 30000, true],
    ['configured_max_buffer', 262144, true], ['duration_ms', 86400000, false],
  ]) {
    const number = source[key];
    if (Number.isFinite(number) && number >= 0 && number <= maximum
      && (!integer || Number.isInteger(number))) result[key] = number;
  }
  if (source.exit_code === null) result.exit_code = null;
  if (typeof source.killed === 'boolean') result.killed = source.killed;
  for (const key of ['started_at', 'finished_at']) {
    if (typeof source[key] === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source[key])
      && Number.isFinite(Date.parse(source[key]))) result[key] = source[key];
  }
  if (SAMPLE_ORIGINS.has(sampleOrigin)) result.sample_origin = sampleOrigin;
  return result;
}

function clockCommandObservation(succeeded, error, options, startedAt, startedTick) {
  let category = 'passed';
  const exitCode = succeeded ? 0 : (Number.isInteger(error?.code) && error.code > 0 && error.code <= 255 ? error.code : null);
  if (!succeeded) {
    if (exitCode !== null) category = 'command_exit';
    else if (error?.code === 'ENOENT') category = 'command_not_found';
    else if (error?.code === 'EACCES' || error?.code === 'EPERM') category = 'command_permission_denied';
    else if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') category = 'command_buffer_limit';
    else if (error?.killed === true) category = 'command_terminated';
    else category = 'command_failed';
  }
  return projectClockDiagnostic({
    category, exit_code: exitCode, killed: error?.killed === true, signal: error?.signal,
    configured_timeout_ms: options.timeout, configured_max_buffer: options.maxBuffer,
    started_at: startedAt, finished_at: new Date().toISOString(),
    duration_ms: Number(process.hrtime.bigint() - startedTick) / 1e6,
    parse_status: 'not_evaluated',
  });
}

function observeTimeSync(result) {
  const diagnostic = projectClockDiagnostic(result.clock_observation);
  if (!result.ok) return { synchronized: false, diagnostic };
  const text = `${result.stdout}\n${result.stderr}`;
  const explicitOffset = text.match(/offset\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i);
  const genericOffset = text.match(/(?:^|\s)([+-]\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)?(?:\s|$)/im);
  const value = Number.parseFloat(explicitOffset?.[1] ?? genericOffset?.[1]);
  const parsed = Number.isFinite(value);
  const synchronized = parsed && Math.abs(value) <= 1;
  diagnostic.category = synchronized ? 'passed' : parsed ? 'offset_outside_limit' : 'offset_unparseable';
  diagnostic.parse_status = synchronized ? 'within_policy' : parsed ? 'outside_policy' : 'not_parseable';
  return { synchronized, diagnostic };
}

module.exports = { clockCommandObservation, observeTimeSync, projectClockDiagnostic };
