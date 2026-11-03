import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as deadman from './deadman.mjs';

let directory: string;
let clock: number;
let monitor: ReturnType<typeof deadman.createDeadman>;
let file: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'conductor-heartbeat-'));
  file = join(directory, '.heartbeat.json');
  clock = 1000000;
  // 缺少可隔离的生产接口时先失败，绝不调用默认固定路径。
  expect(deadman.createDeadman).toBeTypeOf('function');
  monitor = deadman.createDeadman({heartbeatFile:file, now:()=>clock});
  vi.stubEnv('FEISHU_BOT_WEBHOOK', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(directory,{recursive:true,force:true}); });

describe('私有心跳文件与告警边界', () => {
  it('无文件为stale；真实写入、读回stage与确定时钟后过期', () => {
    expect(monitor.isStale().stale).toBe(true);
    monitor.beat('contract');
    expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual({ts:1000000,stage:'contract'});
    expect(monitor.isStale(60000)).toMatchObject({stale:false,stage:'contract',ageMs:0});
    clock += 60001;
    expect(monitor.isStale(60000)).toMatchObject({stale:true,stage:'contract',ageMs:60001});
  });
  it('另一目录的心跳不被读取或覆盖', () => {
    const otherFile=join(directory,'other.json');
    const other=deadman.createDeadman({heartbeatFile:otherFile,now:()=>clock});
    other.beat('other');
    monitor.beat('mine');
    expect(other.isStale().stage).toBe('other');
    expect(monitor.isStale().stage).toBe('mine');
  });
  it.each(['{broken', JSON.stringify({stage:'missing-ts'}), JSON.stringify({ts:'not-a-time'})])('坏心跳%s作为可观察stale返回，不能报健康', record => {
    fs.writeFileSync(file,record);
    expect(monitor.isStale()).toMatchObject({stale:true,reason:expect.stringContaining('无效')});
  });
  it('缺webhook不发送', async () => {
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(await deadman.alertFeishu({stage:'gate',ageMs:120000,reason:'stale'})).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('发送包含stage与秒数的文本', async () => {
    vi.stubEnv('FEISHU_BOT_WEBHOOK','https://example.invalid/feishu');
    let submitted: any;
    vi.stubGlobal('fetch',async(url: string,options: RequestInit)=>{
      expect(url).toBe('https://example.invalid/feishu');
      expect(options.method).toBe('POST');submitted=JSON.parse(options.body as string);
      return {ok:true,status:200};
    });
    expect(await deadman.alertFeishu({stage:'a-lane',ageMs:125000,reason:'stale'})).toBe(true);
    expect(submitted).toMatchObject({msg_type:'text',content:{text:expect.stringContaining('125')}});
    expect(submitted.content.text).toContain('a-lane');
  });
  it.each(['network','http'])('告警%s失败不能冒成功', async failure => {
    vi.stubEnv('FEISHU_BOT_WEBHOOK','https://example.invalid/feishu');
    vi.stubGlobal('fetch',async()=>{if(failure==='network')throw Error('offline');return {ok:false,status:503};});
    expect(await deadman.alertFeishu({stage:'gate',ageMs:90000,reason:'stale'})).toBe(false);
  });
});
