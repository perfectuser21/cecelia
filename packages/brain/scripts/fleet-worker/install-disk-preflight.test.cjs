'use strict';
/* global describe, it, expect */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('默认安装预检磁盘路径', () => {
  it('执行实际 shell 预检函数，数据目录与共享执行目录透传到 probe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-preflight-'));
    try {
      const installer = fs.readFileSync(path.join(__dirname, 'install-fleet-worker.sh'), 'utf8');
      const fn = installer.slice(installer.indexOf('run_default_preflight() {'),
        installer.indexOf('\nrun_preflight() {'));
      const idCommand = path.join(root, 'id');
      fs.writeFileSync(idCommand, '#!/bin/sh\nprintf "501\\n"\n', { mode: 0o755 });
      const hook = path.join(root, 'identity.cjs');
      fs.writeFileSync(hook, 'process.setgroups=()=>{};process.setgid=()=>{};process.setuid=()=>{};');
      const probe = path.join(root, 'probe.cjs');
      fs.writeFileSync(probe, `exports.probeFleetWorkerHealth=async(options)=>{
        console.log(JSON.stringify({options,data:process.env.CECELIA_FLEET_DATA_ROOT,tmp:process.env.TMPDIR}));
        return {orbstack:{version:'ok'},docker:{available:true},runner:{image_digest:'digest'},
        runtime_resources:{postgres:{available:true}},resources:{disk_free_bytes:100*1024**3,disk_used_percent:20,memory_bytes:16*1024**3},worktree:{root_ready:true},container:{probe_succeeded:true}};
      };`);
      const result = spawnSync('bash', ['-s'], {
        input: `${fn}\nrun_default_preflight\n`, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, NODE_OPTIONS: `--require=${hook}`, NODE_PROBE: probe,
          NODE_EXECUTABLE: process.execPath, ID_COMMAND: idCommand, COMMAND_PATH: process.env.PATH,
          SHARED_TMPDIR: path.join(root, 'shared'), FLEET_DATA_ROOT: path.join(root, 'future', 'worker'),
          WORKTREE_ROOT: root, RUNNER_DIGEST: 'digest', POSTGRES_IMAGE: 'test',
          ORBSTACK_HOME: root, BRAIN_HEALTH_URL: 'http://127.0.0.1', machine_id: 'us-mac-m4',
          DRAIN_MARKER: path.join(root, 'drain'), DISK_MIN_FREE_GIB: '10' },
      });
      expect(result.status, result.stderr).toBe(0);
      const record = JSON.parse(result.stdout.trim());
      expect(record.data).toBe(path.join(root, 'future', 'worker'));
      expect(record.options).toEqual({
        diskPaths: [path.join(root, 'future', 'worker'), path.join(root, 'shared')],
        allowMissingDiskPaths: true,
      });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
