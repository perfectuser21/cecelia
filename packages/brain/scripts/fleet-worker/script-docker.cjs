'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

// 命令作为容器 entrypoint 参数传入；宿主不经 shell，任务无权传 docker flags。
function createScriptDockerAdapter({ run = execute } = {}) {
  const command = (args) => run('docker', args, { encoding: 'utf8',timeout:20_000,maxBuffer:1024*1024 });
  return {
    async create({ name, profile, command: script, env = {}, identity }) {
      const args = ['create',`--name=${name}`,'--network=none','--read-only','--cap-drop=ALL',
        '--security-opt=no-new-privileges','--restart=no',`--cpus=${profile.cpus}`,
        `--memory=${profile.memoryBytes}`,`--memory-swap=${profile.memoryBytes}`,`--pids-limit=${profile.pidsLimit}`,
        `--user=${profile.user}`,`--workdir=${profile.cwd}`,'--entrypoint=/bin/sh',
        ...Object.entries(identity).map(([key,value])=>`--label=cecelia.script.${key}=${value}`),
        ...Object.entries(env).map(([key,value])=>`--env=${key}=${value}`),profile.image,'-c',script];
      const { stdout } = await command(args);
      const id=stdout.trim(); if(!/^[a-f0-9]{64}$/.test(id)) throw new Error('script_container_identity_invalid');
      return id;
    },
    async inspect(id) {
      let result;
      try { result=await command(['inspect','--type=container',id]); }
      catch(error) { if (/^Error(?: response from daemon)?: No such (?:object|container):/m.test(error.stderr ?? '')) return null; throw error; }
      const value=JSON.parse(result.stdout)?.[0];
      if(!value || !/^[a-f0-9]{64}$/.test(value.Id)) throw new Error('script_container_inspect_invalid');
      let stdout='',stderr='';
      if(value.State.Status==='exited') {
        const logs=await command(['logs','--tail=1000',id]);stdout=String(logs.stdout??'').slice(-65536);stderr=String(logs.stderr??'').slice(-4096);
      }
      return {id:value.Id,name:value.Name?.replace(/^\//,''),status:value.State.Status,
        exit_code:value.State.ExitCode,stdout,stderr,labels:value.Config?.Labels ?? {}};
    },
    async start(id) { await command(['start',id]); },
    async remove(id) { await command(['rm','--force',id]); },
  };
}
module.exports={createScriptDockerAdapter};
