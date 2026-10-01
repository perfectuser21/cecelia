import { parseActivityContract, parseActivityResult, readActivityPath, object } from './activity-contract.js';
import { callActivityProcess } from './activity-process.js';

function addMetrics(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) target[key] = (target[key] || 0) + value;
    else if (object(value)) { target[key] ||= {}; addMetrics(target[key], value); }
    else target[key] = structuredClone(value);
  }
}
function hasProducts(outputs) {
  return Object.values(outputs).some(value => Array.isArray(value) ? value.length > 0 : value != null);
}

// 显式 opt-in；onEvent 可接既有 run-event-store，无数据库/生产路由副作用。
export async function runActivityContract(contract, input, { cwd = process.cwd(), signal, onEvent = async () => {} } = {}) {
  const plan = parseActivityContract(contract);
  if (!object(input) || typeof input.run_tag !== 'string' || !input.run_tag.trim()) throw new Error('run_tag_required');
  const original = structuredClone(input), context = structuredClone(input);
  const receipt = { schema_version: 1, workflow: plan.workflow, run_tag: input.run_tag,
    status: 'running', outputs: {}, metrics: {}, evidence: [], activities: [] };
  let cursor = 0, failed = false, productive = false, stopped = false;
  const emit = async (event_type, payload = {}) => onEvent({ cursor: ++cursor, event_type, run_tag: input.run_tag, ...payload }, structuredClone(receipt));
  const snapshot = () => ({ context, input: original, item: null });

  function mergeOutputs(result, grouping, item) {
    for (const [key, value] of Object.entries(result.outputs)) {
      if (grouping && key === grouping.items.slice(2)) {
        if (!Array.isArray(value) || value.some(row => !object(row) || row[grouping.identity] !== item[grouping.identity])) {
          throw new Error('per_item_output_identity_mismatch');
        }
        const current = context[key];
        const at = current.findIndex(row => row[grouping.identity] === item[grouping.identity]);
        for (const update of value) Object.assign(current[at], update);
        receipt.outputs[key] = structuredClone(current);
      } else {
        const next = grouping && Array.isArray(value) ? [...(context[key] || []), ...value] : structuredClone(value);
        context[key] = next; receipt.outputs[key] = structuredClone(next);
      }
    }
  }

  async function execute(a, grouping = null, item = null) {
    if (a.runtime.detached) { await emit('ACTIVITY_SKIPPED', { activity: a.key, reason_code: 'detached' }); return; }
    const record = { key: a.key, order: a.order, item: grouping ? item[grouping.identity] : null, status: 'running', attempts: [] };
    receipt.activities.push(record);
    const roots = { ...snapshot(), item };
    if (grouping?.when && readActivityPath(grouping.when.path, roots) !== grouping.when.equals) {
      record.status = 'skipped'; await emit('ACTIVITY_SKIPPED', { activity: a.key, item: record.item, reason_code: 'condition_unmatched' }); return;
    }
    for (let attempt = 1; attempt <= (a.runtime.max_attempts ?? 1); attempt++) {
      let activityInput, result, transport;
      try {
        activityInput = a.runtime.input ? Object.fromEntries(Object.entries(a.runtime.input).map(([key, path]) => {
          const value = readActivityPath(path, roots);
          if (value === undefined) throw new Error('activity_input_path_missing');
          return [key, structuredClone(value)];
        })) : structuredClone(context);
        if (grouping) activityInput[grouping.input] = structuredClone(item);
        activityInput.budget = structuredClone(a.budget);
        activityInput.attempt = attempt;
        await emit('ACTIVITY_STARTED', { activity: a.key, item: record.item, attempt, budget: a.budget });
        transport = await callActivityProcess(a, activityInput, { cwd,
          signal: a.runtime.phase === 'finalize' ? undefined : signal,
          onHeartbeat: details => emit('ACTIVITY_HEARTBEAT', { activity: a.key, item: record.item, attempt, ...details }) });
        result = parseActivityResult(JSON.parse(transport.stdout), activityInput);
        if (result.status === 'completed' && transport.exit_code !== 0 && !transport.reason_code) throw new Error('activity_exit_status_mismatch');
        if (transport.reason_code) result = { ...result, status: hasProducts(result.outputs) ? 'partial' : 'failed',
          failure_class: 'retryable', reason_code: transport.reason_code };
        mergeOutputs(result, grouping, item);
      } catch (error) {
        result = { schema_version: 1, run_tag: input.run_tag, status: 'failed', failure_class: transport?.reason_code ? 'retryable' : 'fatal',
          reason_code: transport?.reason_code || error.message, outputs: {}, metrics: {}, evidence: [] };
      }
      const attemptReceipt = { attempt, ...result, transport: transport || null };
      record.attempts.push(attemptReceipt);
      receipt.metrics[a.key] ||= {}; addMetrics(receipt.metrics[a.key], result.metrics);
      receipt.evidence.push(...structuredClone(result.evidence));
      record.status = result.status;
      await emit('ACTIVITY_FINISHED', { activity: a.key, item: record.item, attempt, status: result.status, failure_class: result.failure_class });
      if (result.status === 'completed') break;
      const declared = result.failure_class === 'needs_human' ? a.failure.needs_human.cases : a.failure[result.failure_class];
      if (!Array.isArray(declared) || declared.length === 0) { record.reason_code = 'undeclared_failure_class'; break; }
      if (result.failure_class !== 'retryable' || signal?.aborted || attempt === (a.runtime.max_attempts ?? 1)) break;
    }
    if (a.runtime.phase !== 'finalize' && record.attempts.some(row => hasProducts(row.outputs))) productive = true;
    if (record.status !== 'completed') {
      failed = true;
      if (a.runtime.phase !== 'finalize' && (a.runtime.on_failure ?? 'stop_run') === 'stop_run') stopped = true;
    }
  }

  await emit('WF_RUN_STARTED', { workflow: plan.workflow });
  const main = plan.activities.filter(a => a.runtime.phase !== 'finalize');
  try {
    for (let i = 0; i < main.length && !stopped; i++) {
      if (signal?.aborted) { failed = true; stopped = true; break; }
      const a = main[i];
      if (a.runtime.phase !== 'per_item') { await execute(a); continue; }
      const grouping = a.runtime.per_item;
      const chain = [a];
      while (main[i + 1]?.runtime.per_item?.group === grouping.group) chain.push(main[++i]);
      const items = readActivityPath(grouping.items, snapshot());
      if (!Array.isArray(items) || items.some(row => !object(row) || row[grouping.identity] == null)
        || new Set(items.map(row => row[grouping.identity])).size !== items.length) throw new Error('per_item_input_identity_invalid');
      // 顺序不可换成活动外循环：当前条目必须走完完整组再进入下一条目。
      for (const item of items) {
        for (const member of chain) { if (stopped) break; await execute(member, member.runtime.per_item, item); }
        if (stopped) break;
      }
    }
  } catch (error) { failed = true; receipt.reason_code = error.message; }
  finally {
    for (const a of plan.activities.filter(a => a.runtime.phase === 'finalize')) {
      try { await execute(a); } catch (error) { failed = true; receipt.reason_code = error.message; }
    }
  }
  receipt.status = failed ? productive ? 'partial' : 'failed' : 'completed';
  await emit('WF_RUN_FINALIZED', { status: receipt.status });
  return receipt;
}
