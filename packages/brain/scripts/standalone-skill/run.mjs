/** Run one Agent against a trusted host and verify the result before reporting completion. */
export async function runStandaloneSkill(identity, { startHost, runAgent, verifyBusiness }) {
  const { task_id: taskId, run_id: runId } = identity;
  if (!taskId || !runId) throw Error('standalone_run_identity_required');

  // Startup owns its partial cleanup. An unknown start must not trigger a second launch.
  const host = await startHost(identity);
  let observed;
  let resourcesReleased = false;
  const request = { taskId, runId, connectionPath: host.connectionPath };
  try {
    if (!request.connectionPath) throw Error('standalone_connection_missing');
    // Agent exit can fail after a durable write. Recover only through the original
    // run's read-only business verifier, without repeating execution.
    try { await runAgent(request); } catch { /* 原业务结果由受信读回核验。 */ }
    observed = await verifyBusiness(request);
  } catch {
    observed = null;
  } finally {
    try {
      const cleanup = await host.close();
      resourcesReleased = cleanup?.task_id === taskId && cleanup.run_id === runId
        && cleanup.local_released === true && cleanup.central_released === true
        && cleanup.native_return_unknown === false;
    } catch {
      resourcesReleased = false;
    }
  }

  const evidence = Array.isArray(observed?.evidence)
    ? observed.evidence.filter(ref => typeof ref === 'string' && ref.trim())
    : [];
  const result = { task_id: taskId, run_id: runId, evidence };
  if (!resourcesReleased || !evidence.length) {
    return {
      ...result,
      status: 'needs_review',
      reason: resourcesReleased ? 'standalone_business_unconfirmed' : 'standalone_cleanup_unconfirmed',
    };
  }
  return { ...result, status: 'completed', summary: observed.summary };
}
