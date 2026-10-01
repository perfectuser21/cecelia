import {describe,expect,it} from 'vitest';
import {usesManagedScript,prepareManagedScript} from '../script-managed-executor.js';
const host='us-mac-m4';
describe('受管模式显式启用边界',()=>{
  it('启用机上所有脚本进入共同入口，未声明profile不得退回SSH',async()=>{
    const task={payload:{}},deps={env:{SCRIPT_MANAGED_MACHINES:host}};
    expect(usesManagedScript(task,{host},deps)).toBe(true);
    await expect(prepareManagedScript(task,{host},null,deps)).resolves.toMatchObject({outcome:'blocked',reason:'script_managed_spec_required'});
  });
  it('显式profile但部署未启用时也明确阻断',async()=>{
    const task={payload:{managed_script:{profile:'p'}}},deps={env:{}};
    expect(usesManagedScript(task,{host},deps)).toBe(true);
    await expect(prepareManagedScript(task,{host},null,deps)).resolves.toMatchObject({outcome:'blocked',reason:'script_managed_not_enabled'});
  });
  it('未切换机器保留宿主脚本语义，不冒称受管',()=>{
    expect(usesManagedScript({payload:{}},{host},{env:{}})).toBe(false);
  });
});
