/** Optional durable ownership adapter; no role/control IO is implemented here. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE = /^[A-Za-z0-9._-]{1,64}$/;
const CONTEXT_KEYS = ['tag', 'host', 'serial', 'profile', 'cap', 'escortName'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

export function validateExistingRolePolicy(policy, roleHandover) {
  if (policy === undefined) return;
  if (policy !== 'replace-stale-existing') throw new Error('invalid_existing_role_policy');
  if (typeof roleHandover !== 'function') throw new Error('existing_role_policy_requires_handover');
}

// Only this constant is executable source. All deployment/run identity enters as argv data.
const HEARTBEAT_PROGRAM = `
const {execFileSync}=require('node:child_process');
(async()=>{
 const c=JSON.parse(process.argv[1]);
 for(const key of ['taskId','tag','host','serial','profile','cap','escortName'])if(typeof c[key]!=='string'||!c[key])throw Error('missing heartbeat identity');
 const parsed=JSON.parse(execFileSync(c.cli,['cron','list','--all','--json'],{encoding:'utf8',timeout:15000,maxBuffer:1048576}));
 if(!Array.isArray(parsed.jobs))throw Error('unreadable cron list');
 const hits=parsed.jobs.filter(j=>j&&j.name===c.escortName);
 if(hits.length!==1)throw Error('ambiguous escort identity');
 const j=hits[0];
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(j.id)||j.agentId!=='work-commander'||j.sessionTarget!=='session:'+c.escortName||j.enabled!==true||j.schedule?.kind!=='every'||j.schedule.everyMs!==600000||!Number.isFinite(j.state?.runningAtMs)||j.state.runningAtMs<=0)throw Error('escort is not the unique running role');
 const body={tag:c.tag,host:c.host,serial:c.serial,profile:c.profile,cap:c.cap,escort_name:c.escortName,escort_id:j.id};
 const response=await fetch(c.heartbeatUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('heartbeat rejected');
 const receipt=await response.json();
 if(receipt?.success!==true||receipt.matched!==true||receipt.task_id!==c.taskId)throw Error('heartbeat ownership not recorded');
})().catch(()=>{console.error('Commander heartbeat evidence unavailable; preserve scene');process.exitCode=1;});
`;

export function buildCommanderHeartbeat(context, builder) {
  if (builder !== undefined) {
    if (typeof builder !== 'function') throw new Error('invalid_heartbeat_builder');
    const command = builder(context);
    // A single absolute Python command with literal argv. No expansion, redirects or operators.
    const word = "(?:'[^'\\n]*'|[A-Za-z0-9_./:@=-]+)";
    const script = "(?:'/[^'\\n]+\\.py'|/[A-Za-z0-9_./-]+\\.py)";
    if (typeof command !== 'string' || !new RegExp(`^/(?:[A-Za-z0-9_.-]+/)*python(?:3(?:\\.[0-9]+)?)? ${script}(?: ${word})*$`).test(command)
        || /[;$`&|<>\r\n]/.test(command)) throw new Error('invalid_heartbeat_command');
    return command;
  }
  const node = process.env.COMMANDER_NODE_BIN || '/opt/homebrew/bin/node';
  const cli = process.env.COMMANDER_OPENCLAW_CLI || '/opt/homebrew/bin/openclaw';
  if (!node.startsWith('/') || !cli.startsWith('/') || /[\0\r\n]/.test(node + cli)) throw new Error('invalid_heartbeat_cli');
  const url = new URL(context.heartbeatUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_heartbeat_url');
  return `${quote(node)} -e ${quote(HEARTBEAT_PROGRAM.replace(/\n/g, ' '))} ${quote(JSON.stringify({ ...context, cli }))}`;
}

function validateCommitted(result, request) {
  const receipt = result?.receipt;
  if (result?.state !== 'committed' || !receipt || result.operationId !== request.operationId
      || receipt.operationId !== request.operationId || receipt.taskId !== request.taskId
      || receipt.previousEscortId !== request.previousEscortId || receipt.escortId !== request.candidateEscortId
      || !UUID.test(receipt.escortId) || !Number.isSafeInteger(receipt.generation) || receipt.generation <= 0
      || !nonempty(receipt.evidenceRef) || !nonempty(receipt.committedAt)
      || !/(?:Z|[+-]\d\d:\d\d)$/.test(receipt.committedAt) || !Number.isFinite(Date.parse(receipt.committedAt))
      || CONTEXT_KEYS.some(key => receipt[key] !== request.context[key])) throw new Error('incomplete_handover_receipt');
  return receipt;
}

/**
 * Adapter phases recover/prepare/observe/commit own durable operationId, real role evidence and generation CAS.
 * A recovered prepared/unknown operation is retained until the adapter supplies an independently observed candidate.
 */
export async function runRoleHandover(task, ctx, io) {
  validateExistingRolePolicy(io.existingRolePolicy, io.roleHandover);
  const context = { tag: ctx.tag, host: ctx.host, serial: ctx.serial, profile: ctx.profile, cap: ctx.cap,
    escortName: `escort-${ctx.host}-${ctx.tag}` };
  const request = { taskId: task.id, context, previousEscortId: ctx.escortId ?? null,
    ...(io.existingRolePolicy === undefined ? {} : { existingRolePolicy: io.existingRolePolicy }) };
  const hook = async (phase, fields = {}) => io.roleHandover({ ...request, ...fields, phase });
  let operation = await hook('recover');
  if (CONTEXT_KEYS.some(key => !SAFE.test(context[key] ?? ''))) throw new Error('incomplete_handover_context');
  if (!operation || !['none', 'prepared', 'candidate', 'committed', 'pending'].includes(operation.state)) throw new Error('invalid_handover_recovery');
  if (operation.state === 'none') {
    const parsed = JSON.parse(await io.list());
    if (!Array.isArray(parsed.jobs)) throw new Error('unreadable_handover_list');
    const hits = parsed.jobs.filter(job => job?.name === context.escortName);
    if (hits.length > 1 || (hits.length === 1 && !UUID.test(hits[0].id))) throw new Error('ambiguous_handover_list');
    const maxAdopt = io.existingRolePolicy === 'replace-stale-existing' ? 0 : io.maxAdopt;
    const adopt = hits.length === 1 && (Number(task.payload?.commander_adopt_count) || 0) < maxAdopt;
    request.mode = adopt ? 'adopt' : 'replace';
    operation = await hook('prepare');
    if (operation?.state !== 'prepared' || !nonempty(operation.operationId)) throw new Error('handover_prepare_refused');
    request.operationId = operation.operationId;
    if (adopt) {
      request.candidateEscortId = hits[0].id;
      operation = await hook('observe');
    } else {
      if (request.previousEscortId) await io.remove(request.previousEscortId);
      let reply;
      try {
        const output = await io.add();
        reply = JSON.parse(output);
        if (!UUID.test(reply?.id)) throw new Error('missing_candidate_uuid');
      } catch (error) {
        await hook('observe', { addResponse: { error: 'pending_unknown', detail: String(error.message).slice(0, 160) } });
        throw new Error('handover_add_response_unknown');
      }
      request.candidateEscortId = reply.id;
      operation = await hook('observe', { addResponse: reply });
    }
  } else {
    if (!nonempty(operation.operationId)) throw new Error('missing_handover_operation');
    request.operationId = operation.operationId;
    request.mode = operation.mode;
    request.previousEscortId = operation.previousEscortId;
    request.candidateEscortId = operation.candidateEscortId;
  }
  if (!['candidate', 'committed'].includes(operation?.state) || !UUID.test(request.candidateEscortId)
      || operation.operationId !== request.operationId || operation.candidateEscortId !== request.candidateEscortId
      || !['adopt', 'replace'].includes(request.mode)) throw new Error('handover_pending');
  // Idempotent commit must refresh actual role/CAS evidence, including recovery after a task-patch interruption.
  operation = await hook('commit');
  const receipt = validateCommitted(operation, request);
  if (task.payload?.commander_handover_operation_id === request.operationId && task.payload?.escort_id === receipt.escortId) {
    return { ok: true, adopted: true, id: receipt.escortId };
  }
  const adopted = request.mode === 'adopt';
  const at = new Date(io.now).toISOString();
  const count = ctx.relaunchCount + (adopted ? 0 : 1);
  const patch = { escort_id: receipt.escortId, escort_name: context.escortName, tag: context.tag, host: context.host,
    commander_handover_operation_id: request.operationId, commander_handover_generation: receipt.generation,
    commander_relaunched_at: at };
  if (adopted) patch.commander_adopt_count = (Number(task.payload?.commander_adopt_count) || 0) + 1;
  else patch.commander_relaunch_count = count;
  if (!await io.patch(patch)) throw new Error('handover_payload_not_written');
  await io.event(adopted ? 'commander_adopted' : 'commander_relaunched', {
    escort_id: receipt.escortId, prev_escort_id: request.previousEscortId, operation_id: request.operationId, count,
    tag: context.tag, host: context.host,
  });
  try {
    await io.activate(receipt.escortId);
    await io.event('commander_activation_requested', { escort_id: receipt.escortId, tag: context.tag, host: context.host });
  } catch {
    await io.event('commander_activation_failed', { escort_id: receipt.escortId, tag: context.tag, host: context.host });
  }
  return { ok: true, adopted, id: receipt.escortId, count };
}
