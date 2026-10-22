import {describe,it,expect,vi} from 'vitest';
import {bootstrapInfraRegistry} from '../infra-registry-bootstrap.js';

const request=()=>({task_id:'a6aa895d-f91e-4eb4-bdc6-242119ca46ce',client_request_id:'unit-admission',expected_registry_sha256:'a'.repeat(64),revision:'b'.repeat(40)});

describe('infra bootstrap写入前拒绝边界',()=>{
 for(const field of ['task_id','client_request_id','expected_registry_sha256','revision']){
  for(const value of [[],{},null,42])it(`${field}非字符串在任何DB访问前拒绝：${JSON.stringify(value)}`,async()=>{
   const query=vi.fn(()=>{throw Error('DB_MUST_NOT_RUN');});
   await expect(bootstrapInfraRegistry({query},{...request(),[field]:value})).rejects.toMatchObject({code:'INFRA_BOOTSTRAP_INPUT_INVALID',status:400});
   expect(query).not.toHaveBeenCalled();
  });
 }
 for(const patch of [{client_request_id:' '},{revision:'B'.repeat(40)},{expected_registry_sha256:'a'.repeat(63)},{actor:'forged-owner'}])it(`无效请求不得先读授权或写库：${JSON.stringify(patch)}`,async()=>{
  const query=vi.fn(()=>{throw Error('DB_MUST_NOT_RUN');});
  await expect(bootstrapInfraRegistry({query},{...request(),...patch})).rejects.toMatchObject({code:'INFRA_BOOTSTRAP_INPUT_INVALID',status:400});
  expect(query).not.toHaveBeenCalled();
 });
 it('仅猜到合法任务UUID不能启动取源或写入事务',async()=>{
  const query=vi.fn(async()=>({rows:[]}));
  await expect(bootstrapInfraRegistry({query},request())).rejects.toMatchObject({code:'INFRA_BOOTSTRAP_TASK_FORBIDDEN',status:403});
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toMatch(/^SELECT \* FROM tasks/);
 });
 it('任务已存在但claim被撤销仍在取源前拒绝',async()=>{
  const query=vi.fn(async()=>({rows:[{status:'in_progress',claimed_by:'another-session'}]}));
  await expect(bootstrapInfraRegistry({query},request())).rejects.toMatchObject({code:'INFRA_BOOTSTRAP_TASK_FORBIDDEN',status:403});
  expect(query).toHaveBeenCalledTimes(1);
 });
});
