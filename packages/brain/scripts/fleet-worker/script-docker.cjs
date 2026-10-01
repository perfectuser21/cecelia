'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

// 命令作为容器 entrypoint 参数传入；宿主不经 shell，任务无权传 docker flags。
function createScriptDockerAdapter({ run = execute } = {}) {
  const command = (args) => run('docker', args, { encoding: 'utf8',timeout:20_000,maxBuffer:1024*1024 });
  return {
    async create({ name, profile, command: script, env = {}, identity }) {
      const args = ['create',`--name=${name}`,'--log-driver=local',
        `--log-opt=max-size=${profile.logMaxSizeBytes}`,`--log-opt=max-file=${profile.logMaxFiles}`,'--network=none','--read-only','--cap-drop=ALL',
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
      return {id:value.Id,name:value.Name?.replace(/^\//,''),status:value.State.Status,
        exit_code:value.State.ExitCode,labels:value.Config?.Labels ?? {}};
    },
    async logs(id) {
      try {
        const result=await run('docker',['logs','--tail=1000',id],{encoding:'utf8',timeout:10_000,maxBuffer:65536});
        return {stdout:result.stdout??'',stderr:result.stderr??''};
      } catch(error) {
        if(error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return {stdout:String(error.stdout??'').slice(-65536),stderr:'script_logs_truncated',logs_truncated:true};
        return {stdout:'',stderr:'script_logs_unavailable',logs_unavailable:true};
      }
    },
    async start(id) { await command(['start',id]); },
    async remove(id) { await command(['rm','--force',id]); },
  };
}
module.exports={createScriptDockerAdapter};
