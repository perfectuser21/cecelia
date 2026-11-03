import { describe, test, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callActivityProcess } from '../activity-process.js';

const fixtureDir = dirname(fileURLToPath(new URL('./fixtures/activity-runtime/activity.mjs', import.meta.url)));

describe('activity-process真实进程边界', () => {
  test('等待Commander回答不消耗执行者的业务时限，回复后恢复计时', async () => {
    const cwd=await mkdtemp(join(tmpdir(),'activity-question-budget-'));
    try{
      await writeFile(join(cwd,'question.mjs'),`import {createInterface} from 'node:readline';let n=0;for await(const line of createInterface({input:process.stdin})){if(n++===0)process.stderr.write(JSON.stringify({protocol:'activity-agent-event/v1',type:'question',text:'请确认读回字段'})+'\\n');else{console.log('{"answer":42}');process.exit(0);}}`);
      const result=await callActivityProcess({budget:{max_duration_s:0.15,heartbeat_s:1},runtime:{entry:'question.mjs',interactive:true,cleanup_grace_s:1}}, {}, {cwd,onAgentEvent:async()=>{await new Promise(r=>setTimeout(r,200));return {action:'answer',text:'按A4读回'};}});
      expect(result.reason_code).toBe(null);
      expect(JSON.parse(result.stdout).answer).toBe(42);
      expect(result.duration_s).toBeGreaterThan(0.2);
      expect(result.supervision_wait_ms).toBeGreaterThanOrEqual(190);
      expect(result.duration_s*1000-result.supervision_wait_ms).toBeLessThan(150);
    }finally{await rm(cwd,{recursive:true,force:true});}
  },5000);
  test('agent问题经过真实双向管道收到纠偏，最终JSON仍独立解析', async () => {
    const cwd=await mkdtemp(join(tmpdir(),'activity-process-interactive-'));
    try{
      await writeFile(join(cwd,'interactive.mjs'),`import {createInterface} from 'node:readline';let n=0;for await(const line of createInterface({input:process.stdin})){const x=JSON.parse(line);if(n++===0)process.stderr.write(JSON.stringify({protocol:'activity-agent-event/v1',type:'question',text:'缺少A4证据怎么办？'})+'\\n');else{console.log(JSON.stringify({outputs:{guidance:x.text}}));process.exit(0);}}`);
      const events=[];
      const result=await callActivityProcess({budget:{max_duration_s:2,heartbeat_s:1},runtime:{entry:'interactive.mjs',interactive:true,cleanup_grace_s:1}}, {}, {cwd,onAgentEvent:async e=>{events.push(e);return {action:'steer',text:'先独立读回A4'};}});
      expect(events.map(e=>e.type)).toEqual(['question']);
      expect(JSON.parse(result.stdout).outputs.guidance).toBe('先独立读回A4');
      expect(result.agent_events.some(e=>e.type==='guidance_delivered'&&e.action==='steer')).toBe(true);
      expect(result.reason_code).toBe(null);
    }finally{await rm(cwd,{recursive:true,force:true});}
  },5000);
  test('持续心跳不冒充进展；停滞告警可中止agent并取得实际退出', async () => {
    const cwd=await mkdtemp(join(tmpdir(),'activity-process-stall-'));
    try{
      await writeFile(join(cwd,'stall.mjs'),`process.stdin.resume();setInterval(()=>{},1000);`);
      const events=[];
      const result=await callActivityProcess({budget:{max_duration_s:3,heartbeat_s:1},runtime:{entry:'stall.mjs',cleanup_grace_s:1}}, {}, {cwd,stallAfterMs:100,onAgentEvent:async e=>{events.push(e);return {action:'abort',reason:'没有进展'};}});
      expect(events.map(e=>e.type)).toEqual(['stall']);
      expect(result.reason_code).toBe('commander_abort');
      expect(result.exit_signal).toBe('SIGTERM');
    }finally{await rm(cwd,{recursive:true,force:true});}
  },5000);
  test('真实子进程逐字节输出UTF-8，产物与stderr不得损坏', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'activity-process-utf8-'));
    try {
      const stdout = JSON.stringify({ outputs: { comments: [{ text: '如何报名人工智能课程' }] } });
      const stderr = '地区：杭州';
      await writeFile(join(cwd, 'utf8.mjs'), `const out=${JSON.stringify(stdout)},err=${JSON.stringify(stderr)};
for (const [stream,text] of [[process.stdout,out],[process.stderr,err]]) {
  for (const byte of Buffer.from(text)) { stream.write(Buffer.from([byte])); await new Promise(r=>setTimeout(r,5)); }
}`);
      const result = await callActivityProcess({ budget: { max_duration_s: 10, heartbeat_s: 1 },
        runtime: { entry: 'utf8.mjs', argv: [] } }, { run_tag: 'utf8-run' }, { cwd });
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toBe(stdout);
      expect(result.stderr).toBe(stderr);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  test('预算内真实心跳触发安全取消，返回活动清理产物及真实退出码', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'activity-process-heartbeat-'));
    try {
      const controller = new AbortController(), heartbeats = [];
      const result = await callActivityProcess({ budget: { max_duration_s: 10, heartbeat_s: 1 },
        runtime: { entry: 'activity.mjs', argv: ['safe-stop'], cleanup_grace_s: 1 } },
      { run_tag: 'heartbeat-run', trace: join(dir, 'trace') }, {
        cwd: fixtureDir, signal: controller.signal, onHeartbeat: async event => {
          heartbeats.push(event); controller.abort();
        },
      });
      expect(heartbeats).toHaveLength(1);
      expect(heartbeats[0].elapsed_s).toBeGreaterThanOrEqual(0.9);
      expect(result.reason_code).toBe('run_cancelled');
      expect(result.exit_code).toBe(2);
      expect(JSON.parse(result.stdout).outputs.fragments).toEqual([{ id: 'safely-retained' }]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 10000);
  test('无执行权的SH入口返回真实EACCES，不冒充活动成功', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'activity-process-admission-'));
    try {
      await writeFile(join(cwd, 'blocked.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o600 });
      const result = await callActivityProcess({ budget: { max_duration_s: 5, heartbeat_s: 1 },
        runtime: { entry: 'blocked.sh', argv: [] } }, { run_tag: 'admission-run' }, { cwd });
      expect(result.reason_code).toBe('EACCES');
      expect(result.exit_code).not.toBe(0);
      expect(result.stdout).toBe('');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
