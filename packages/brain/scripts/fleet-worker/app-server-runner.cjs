'use strict';
const fs = require('node:fs');
const { createBoundedAppServerStream } = require('./app-server-stream.cjs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validateAppServerProfile, profileDigest, generationOwner } = require('./app-server-profile.cjs');
const {verifyCanaryPermit}=require('./app-server-canary-permit.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const BINDINGS = ['reservation_id', 'intent_id', 'launch_generation', 'machine_id', 'worker_id',
  'worker_boot_id', 'home_key', 'owner_key', 'config_digest', 'profile'];
const ALLOWED = [...BINDINGS, 'container_id', 'challenge', 'stream_id', 'canary_permit'];

function createAppServerRunner({ stateRoot, machineId, workerId, bootId, profiles = {}, docker, assertLocalResources, assertCanLaunch = () => {}, canaryKey }) {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(stateRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw new Error('appserver_journal_untrusted');
  const root = fs.realpathSync(stateRoot);
  const connections = new Map(), pendingStreamCloses = new Map();
  function syncDirectory() {
    const fd = fs.openSync(root, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function read(filename) {
    let fd;
    try { fd = fs.openSync(path.join(root, filename), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('appserver_journal_untrusted'); }
    try {
      const value = fs.fstatSync(fd);
      if (!value.isFile() || value.size > 65536 || (value.mode & 0o077) !== 0
          || (value.uid !== 0 && value.uid !== process.getuid?.())) throw new Error('appserver_journal_untrusted');
      return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  }
  function write(filename, value, exclusive = false) {
    const dest = path.join(root, filename), temp = exclusive ? dest : `${dest}.${randomUUID()}`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!exclusive) fs.renameSync(temp, dest);
    syncDirectory();
  }
  const save = state => write(`${state.reservation_id}.json`, state);
  const bindings = state => Object.fromEntries(BINDINGS.map(key => [key, state[key]]));
  const matches = (a, b) => BINDINGS.every(key => a[key] === b[key]);
  function validate(input) {
    if (!input || Object.keys(input).some(key => !ALLOWED.includes(key))
        || !UUID.test(input.reservation_id) || !UUID.test(input.intent_id) || !UUID.test(input.worker_boot_id)
        || input.machine_id !== machineId || input.worker_id !== workerId
        || !Number.isSafeInteger(input.launch_generation) || input.launch_generation < 1
        || !/^openclaw-[a-f0-9]{64}$/.test(input.owner_key) || !HASH.test(input.config_digest)
        || !/^[a-z][a-z0-9-]{0,63}$/.test(input.profile)) throw new Error('appserver_identity_invalid');
  }
  // 只由已确认的 attach 通道 close 产生事件；持锁重放，不表示容器已停止。
  function flushStreamClose(reservationId) {
    const pending = pendingStreamCloses.get(reservationId);
    if (!pending) return;
    const current = read(`${reservationId}.json`);
    if (current?.stream_id === pending.streamId && matches(current, pending.identity)) {
      current.stream_status = 'closed'; save(current);
    }
    if (connections.get(reservationId) === pending.child) connections.delete(reservationId);
    pendingStreamCloses.delete(reservationId);
  }
  async function locked(input, operation) {
    validate(input);
    const lock = path.join(root, `${input.reservation_id}.lock`);
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('appserver_operation_locked'); throw error; }
    try {
      flushStreamClose(input.reservation_id);
      const state = read(`${input.reservation_id}.json`);
      if (state && !matches(state, input)) throw new Error('appserver_identity_mismatch');
      return await operation(state);
    } finally {
      try { flushStreamClose(input.reservation_id); } finally { fs.rmdirSync(lock); }
    }
  }
  function initial(input) {
    const profile = profiles[input.profile];
    if (!profile) throw new Error('appserver_profile_unavailable');
    const snapshot = validateAppServerProfile(profile);
    if (input.config_digest !== profileDigest(snapshot) || input.home_key !== snapshot.homeKey || input.owner_key !== generationOwner(input)) {
      throw new Error('appserver_identity_mismatch');
    }
    return { ...bindings(input), profile_snapshot: snapshot, container_id: null,
      container_name: `cecelia-appserver-${input.reservation_id}-g${input.launch_generation}`,
      status: 'launching', tombstoned: false, created_at: Date.now() };
  }
  function acquireHome(state) {
    const name = `home-${state.profile_snapshot.homeKey}.json`;
    try { write(name, bindings(state), true); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = read(name);
      if (!existing || !matches(existing, state)) throw new Error('appserver_home_busy');
    }
  }
  function releaseHome(state) {
    const name = `home-${state.profile_snapshot.homeKey}.json`, owner = read(name);
    if (owner && matches(owner, state)) { fs.unlinkSync(path.join(root, name)); syncDirectory(); }
  }
  async function observe(state) {
    const container = await docker.inspect(state.container_id ?? state.container_name);
    if (!container) return { ...state, status: state.tombstoned ? 'cleaned'
      : state.status === 'waiting_resources' ? 'waiting_resources' : 'unknown' };
    if (!HASH.test(container.id) || container.name !== state.container_name
        || (state.container_id && container.id !== state.container_id)
        || ['reservation_id', 'intent_id', 'launch_generation'].some(key =>
          container.labels?.[`cecelia.appserver.${key}`] !== String(state[key]))) throw new Error('appserver_identity_mismatch');
    if (!state.container_id) { state.container_id = container.id; save(state); }
    return { ...state, status: container.status, oomKilled: container.oomKilled === true };
  }
  return {
    async maintenance() {
      try {
        let pending = connections.size + pendingStreamCloses.size;
        for (const filename of fs.readdirSync(root)) {
          if (/^home-[a-f0-9]{64}\.json$/.test(filename)) {
            const owner = read(filename); validate(owner);
            if (!read(`${owner.reservation_id}.json`)) throw Error('unbound_home');
            continue;
          }
          if (!UUID.test(filename.replace(/\.json$/, '')) || !filename.endsWith('.json')) throw Error('unknown_journal');
          const state = read(filename); if (!state) throw Error("missing_journal"); validate(bindings(state));
          if (state.status !== 'cleaned' || state.tombstoned !== true) pending++;
        }
        return { pending };
      } catch { throw Error('worker_maintenance_unconfirmed'); }
    },
    capabilities() {
      return { machine_id: machineId, worker_id: workerId, worker_boot_id: bootId,
        profiles: Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, profileDigest(profile)])) };
    },
    async start(input) {
      assertCanLaunch();
      return locked(input, async state => {
        if (state?.tombstoned) throw new Error('appserver_launch_tombstoned');
        const canary=input.canary_permit?verifyCanaryPermit(input.canary_permit,bindings(input),canaryKey):null;
        if(state&&(JSON.stringify(state.canary??null)!==JSON.stringify(canary)))throw Error('appserver_canary_permit_invalid');
        if (state && state.status !== 'waiting_resources') return observe(state);
        if (input.worker_boot_id !== bootId) throw new Error('appserver_worker_changed');
        state ??= initial(input);
        if(canary)state.canary=canary;
        acquireHome(state);
        save(state);
        const admit = async () => {
          if (typeof assertLocalResources !== 'function') throw new Error('appserver_local_resources_unavailable');
          try { await assertLocalResources(state.profile_snapshot); return true; }
          catch (error) {
            if (!/^(attempt|appserver)_local_resources_unavailable$/.test(error.message)) throw error;
            state.status = 'waiting_resources'; save(state); return false;
          }
        };
        if (!await admit()) return state;
        assertCanLaunch();
        if (!state.container_id) {
          state.status = 'launching'; save(state);
          state.container_id = await docker.create({ name: state.container_name, profile: state.profile_snapshot,
            identity: { reservation_id: state.reservation_id, intent_id: state.intent_id, launch_generation: state.launch_generation } });
          if (!HASH.test(state.container_id)) throw new Error('appserver_identity_mismatch');
          save(state);
        }
        if (!await admit()) return state;
        assertCanLaunch();
        state.status = 'starting'; save(state);
        assertCanLaunch();
        await docker.start(state.container_id);
        state.status = 'running'; save(state);
        return observe(state);
      });
    },
    async inspect(input) {
      return locked(input, async state => {
        if (!state) throw new Error('appserver_intent_unknown');
        return observe(state);
      });
    },
    async markRpcStarted(input) {
      return locked(input, async state => {
        if (!state || state.tombstoned || state.stream_id !== input.stream_id || state.stream_status !== 'attached') throw Error('appserver_stream_identity_mismatch');
        state.rpc_started = true; save(state);
      });
    },
    async recordCanaryEvidence(input,evidence){
      return locked(input,async state=>{
        if(!state?.canary||state.tombstoned||state.stream_id!==input.stream_id||!['attached','closed'].includes(state.stream_status)
          ||(state.stream_status==='closed'&&evidence.sealed!==true))throw Error('appserver_canary_evidence_invalid');
        if(state.canary_evidence?.sealed===true)throw Error('appserver_canary_evidence_sealed');
        state.canary_evidence={...state.canary,...evidence,stream_id:input.stream_id};save(state);
      });
    },
    async attach(input, {deadline = Infinity} = {}) {
      assertCanLaunch();
      if (!UUID.test(input.stream_id)) throw new Error('appserver_stream_identity_required');
      return locked(input, async state => {
        if (!state || state.tombstoned) throw new Error('appserver_launch_tombstoned');
        if(state.canary&&state.canary.expires_at<=Date.now())throw Error('appserver_canary_permit_invalid');
        if (state.rpc_started) throw Error('appserver_stream_recovery_required');
        if (state.stream_status && state.stream_status !== 'closed') throw new Error('appserver_stream_busy');
        if (input.worker_boot_id !== bootId) throw Error('appserver_worker_changed');
        if ((await observe(state)).status !== 'running') throw new Error('appserver_not_running');
        if (typeof assertLocalResources !== 'function') throw Error('appserver_local_resources_unavailable');
        await assertLocalResources(state.profile_snapshot);
        assertCanLaunch();
        if (Date.now() >= deadline) throw Error('appserver_stream_ticket_expired');
        state.stream_id = input.stream_id; state.stream_status = 'attaching'; save(state);
        assertCanLaunch();
        const raw = await docker.attach(state.container_id, { deadline });
        if (Date.now() >= deadline || raw.closed) { raw.kill(); throw Error('appserver_attach_unconfirmed'); }
        const child = createBoundedAppServerStream(raw);
        child.rpcAccountId = state.profile_snapshot.authAccountId ?? null;
        child.rpcHostTools = state.profile_snapshot.hostTools;
        child.rpcCanary=Boolean(state.canary);child.rpcCanaryExpiresAt=state.canary?.expires_at;
        connections.set(state.reservation_id, child);
        const releaseStream = () => {
          pendingStreamCloses.set(state.reservation_id, {
            identity: bindings(state), streamId: input.stream_id, child,
          });
          // 当前操作持锁时由 finally 重放；外部锁/落盘失败则保留事件，下一次取锁重放。
          locked(bindings(state), async () => {}).catch(() => {});
        };
        // 错误只请求断流；确认 attach 通道关闭后才落盘 closed。
        child.on('error', () => {});
        child.once('close', releaseStream);
        state.stream_status = 'attached'; save(state);
        return child;
      });
    },
    close() { for (const child of connections.values()) child.kill('SIGTERM'); },
    async cancel(input) {
      if (!UUID.test(input.challenge)) throw new Error('appserver_cleanup_challenge_required');
      return locked(input, async state => {
        if(!state && input.worker_boot_id!==bootId)throw new Error('appserver_intent_unknown');
        state ??= initial(input);
        if (input.container_id !== state.container_id) throw new Error('appserver_identity_mismatch');
        state.tombstoned = true; state.status = 'cleanup_pending'; save(state);
        connections.get(state.reservation_id)?.kill('SIGTERM');
        const observed = await observe(state);
        if (observed.container_id !== input.container_id) throw new Error('appserver_identity_mismatch');
        if (observed.status !== 'cleaned') await docker.remove(state.container_id);
        if (await docker.inspect(state.container_id ?? state.container_name)) throw new Error('appserver_cleanup_unconfirmed');
        state.status = 'cleaned'; save(state); releaseHome(state);
        return { ...bindings(state), container_id: state.container_id, absent: true,
          status: 'cleaned', tombstoned: true, challenge: input.challenge };
      });
    },
  };
}

module.exports = { createAppServerRunner };
