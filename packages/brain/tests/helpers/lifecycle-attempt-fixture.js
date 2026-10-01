// Lifecycle/upgrade tests seed historical rows deliberately, including machines
// that predate today's admission registry. Creation/admission tests must use the
// real createAttempt boundary instead of this fixture writer.
export async function seedLifecycleAttempt(pool, input) {
  if (process.env.NODE_ENV !== 'test') throw new Error('lifecycle fixture requires NODE_ENV=test');
  const skill = input.bundle?.skill ?? {};
  const result = await pool.query(`INSERT INTO harness_attempts (
    id,run_id,hop,phase,role,provider,account_id,machine_id,requested_machine_id,
    local_container_naming,skill_name,skill_version,skill_digest,task_bundle,
    callback_secret_hash,logical_cycle_id,attempt_kind,retry_of_attempt_id,restart_reason,
    workstream_key,time_derived
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,'generation-v1',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  RETURNING *`, [
    input.id,input.runId,input.hop,input.phase,input.role,input.provider ?? 'auto',
    input.accountId ?? null,input.machineId ?? null,skill.name ?? null,skill.version ?? null,skill.digest ?? null,
    input.bundle ?? {},input.callbackSecretHash,input.logicalCycleId ?? `intent:${input.runId}:${input.hop}`,
    input.attemptKind ?? 'initial',input.retryOfAttemptId ?? null,input.restartReason ?? null,
    input.workstreamKey ?? 'ws1',input.timeDerived ?? ['judge','reporter'].includes(input.role),
  ]);
  return result.rows[0];
}
