'use strict';
const { execFile, spawn: spawnChild } = require('node:child_process');
const { promisify } = require('node:util');
const { validateAppServerProfile } = require('./app-server-profile.cjs');
const ID = /^[a-f0-9]{64}$/;
const NAME = /^cecelia-appserver-[a-f0-9-]{36}-g[1-9][0-9]*$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function createAppServerDocker({ run = promisify(execFile), spawn = spawnChild } = {}) {
  const command = async args => {
    try { return await run('docker', args, { encoding: 'utf8', timeout: 20000, maxBuffer: 1048576 }); }
    catch (error) {
      const absent = /^Error(?: response from daemon)?: No such (?:object|container):/m.test(error.stderr ?? '');
      throw Object.assign(new Error('appserver_docker_unavailable'), { absent });
    }
  };
  const exact = id => { if (!ID.test(id)) throw new Error('appserver_container_id_invalid'); };
  async function verifyResource(kind, name, key) {
    const { stdout } = await command([kind === 'network' ? 'network' : 'volume', 'inspect', name]);
    let resource;
    try { resource = JSON.parse(stdout)?.[0]; } catch { /* 固定错误，不记录 Docker 原始响应。 */ }
    if (resource?.Name !== name || resource?.Labels?.['cecelia.appserver.kind'] !== kind
        || resource.Labels['cecelia.appserver.key'] !== key) throw new Error('appserver_resource_untrusted');
  }
  return {
    async create({ name, profile: rawProfile, identity }) {
      const profile = validateAppServerProfile(rawProfile);
      if (!NAME.test(name)) throw new Error('appserver_container_name_invalid');
      const home = `cecelia-appserver-home-${profile.homeKey}`;
      const workspace = `cecelia-appserver-workspace-${profile.workspaceKey}`;
      await verifyResource('home', home, profile.homeKey);
      await verifyResource('workspace', workspace, profile.workspaceKey);
      if (profile.network !== 'none') await verifyResource('network', profile.network, profile.network);
      if (!UUID.test(identity?.reservation_id) || !UUID.test(identity?.intent_id)
          || !Number.isSafeInteger(identity.launch_generation) || identity.launch_generation < 1
          || Object.keys(identity).some(key => !['reservation_id', 'intent_id', 'launch_generation'].includes(key))) {
        throw new Error('appserver_identity_invalid');
      }
      const args = ['create', '--interactive', `--name=${name}`, '--init', '--log-driver=none',
        `--network=${profile.network}`, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--restart=no', `--cpus=${profile.cpus}`, `--memory=${profile.memoryBytes}`,
        `--memory-swap=${profile.memoryBytes}`, `--pids-limit=${profile.pidsLimit}`, `--user=${profile.user}`,
        '--workdir=/workspace', '--entrypoint=/usr/local/bin/codex',
        `--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=${profile.tmpBytes},mode=1777`,
        `--mount=type=volume,src=${home},dst=/home/runner`,
        `--mount=type=volume,src=${workspace},dst=/workspace`,
        '--env=HOME=/home/runner', '--env=CODEX_HOME=/home/runner/.codex',
        ...Object.entries(identity).map(([key, value]) => `--label=cecelia.appserver.${key}=${value}`),
        profile.image, '-c', 'cli_auth_credentials_store="ephemeral"', 'app-server', '--listen', 'stdio://'];
      const { stdout } = await command(args);
      const id = stdout.trim(); exact(id); return id;
    },
    async inspect(id) {
      if (!ID.test(id) && !NAME.test(id)) throw new Error('appserver_container_id_invalid');
      let result;
      try { result = await command(['inspect', '--type=container', id]); }
      catch (error) { if (error.absent) return null; throw error; }
      let value;
      try { value = JSON.parse(result.stdout)?.[0]; } catch { /* 返回固定错误。 */ }
      if (!ID.test(value?.Id) || !value?.State) throw new Error('appserver_inspect_invalid');
      return { id: value.Id, name: value.Name?.replace(/^\//, ''), status: value.State.Status,
        oomKilled: value.State.OOMKilled === true, labels: value.Config?.Labels ?? {} };
    },
    async start(id) { exact(id); await command(['start', id]); },
    async remove(id) { exact(id); await command(['rm', '--force', id]); },
    attach(id) {
      exact(id);
      return spawn('docker', ['attach', '--sig-proxy=false', id], { stdio: ['pipe', 'pipe', 'ignore'] });
    },
  };
}

module.exports = { createAppServerDocker };
