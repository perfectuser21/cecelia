#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertWalkingCiMode, isWalkingCheckpointWaiting } from '../../src/lib/walking-callback-worker.js';

// Validate actual container environment before importing any database clients.
assertWalkingCiMode();
const [mode, thread] = process.argv.slice(2);
assert.ok(['waiting', 'completed'].includes(mode));
assert.match(thread || '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
// This timer lives inside docker exec; killing only the host CLI would leave a reader behind.
const deadline = setTimeout(() => { console.error('Walking PG proof deadline reached'); process.exit(1); }, 7000);
deadline.unref();
const { getPgCheckpointer } = await import('../../src/orchestrator/pg-checkpointer.js');
const { getCompiledWalkingSkeleton } = await import('../../src/workflows/walking-skeleton-1node.graph.js');
const { default: pool } = await import('../../src/db.js');
let checkpointer;
try {
  checkpointer = await getPgCheckpointer();
  const graph = await getCompiledWalkingSkeleton(checkpointer);
  const state = await graph.getState({ configurable: { thread_id: thread } });
  const lookup = (await pool.query('SELECT container_id,status,result FROM walking_skeleton_thread_lookup WHERE thread_id=$1', [thread])).rows;
  assert.equal(lookup.length, 1, 'Exactly one real worker belongs to this thread');
  assert.equal(state.values.triggerId, thread);
  assert.equal(state.values.containerId, lookup[0].container_id);
  assert.ok(state.config?.configurable?.checkpoint_id, 'State must come from a persisted PG checkpoint');
  const events = (await pool.query("SELECT count(*)::int AS count FROM task_events WHERE task_id=$1::uuid AND event_type='walking_skeleton_done' AND payload->>'thread_id'=$1::text", [thread])).rows[0].count;
  if (mode === 'waiting') {
    assert.ok(isWalkingCheckpointWaiting(state),
    'Require decoded persisted interrupt, not a spawning lookup guess');
    assert.notEqual(state.values.finalized, true); assert.equal(events, 0);
  } else {
    assert.equal(state.values.finalized, true); assert.equal(state.next.length, 0);
    assert.equal(lookup[0].status, 'completed'); assert.equal(events, 1, 'One actual completion event required');
    assert.equal(state.values.result, `hello-from-${lookup[0].container_id}`);
  }
  console.log(JSON.stringify({ thread_id: thread, mode, container_id: lookup[0].container_id,
    checkpoint_id: state.config.configurable.checkpoint_id, restart_instance: state.values.restartInstanceId, finalized: state.values.finalized, events }));
} finally {
  await checkpointer?.end(); await pool.end(); clearTimeout(deadline);
}
