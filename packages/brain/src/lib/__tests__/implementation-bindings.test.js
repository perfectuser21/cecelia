import { it,expect,vi } from 'vitest';
import { validateImplementationBindings } from '../implementation-bindings.js';
const binding={kind:'skill',repo:'org/repo',path:'skills/check/SKILL.md',revision:'a'.repeat(40),name:'check',version:'1.0.0'};
const skill='---\nname: check\nversion: 1.0.0\n---\n# 验证';
it('Skill声明名称和版本必须匹配固定commit文件，记录真实内容digest',async()=>{
  const result=await validateImplementationBindings({implementation_bindings:[binding]},async()=>skill);
  expect(result[0].content_sha256).toMatch(/^[0-9a-f]{64}$/);expect(result[0].validation_scope).toBe('reference_only');
  await expect(validateImplementationBindings({implementation_bindings:[{...binding,version:'2.0.0'}]},async()=>skill)).rejects.toThrow('version');
  await expect(validateImplementationBindings({implementation_bindings:[{...binding,sha256:'b'.repeat(64)}]},async()=>skill)).rejects.toThrow('digest');
});
it('活动和步骤组合保留位置，Code symbol未经证实标unresolved，旧字符串不推断身份',async()=>{
  const code={kind:'code',repo:'org/repo',path:'src/a.js',revision:'a'.repeat(40),symbol:'run'};
  const result=await validateImplementationBindings({execution:{via:'自由描述'},runtime:code,steps:[{key:'one',implementation_bindings:[binding]}]},async b=>b.kind==='skill'?skill:'export function other(){}');
  expect(result.find(x=>x.kind==='code')).toMatchObject({status:'unresolved',scope:'activity',field:'runtime'});
  expect(result.find(x=>x.kind==='skill')).toMatchObject({scope:'step',step_key:'one',status:'verified'});
  expect(result.find(x=>x.kind==='raw')).toMatchObject({raw:'自由描述',status:'unresolved'});
});
it('浮动revision、路径越界和空引用全部拒绝',async()=>{
  for(const patch of [{revision:'main'},{path:'../SKILL.md'}]) await expect(validateImplementationBindings({implementation_bindings:[{...binding,...patch}]},vi.fn())).rejects.toThrow();
  await expect(validateImplementationBindings({implementation_bindings:[binding]},async()=> '')).rejects.toThrow();
});

it('既有Skill digest=sha256:<hex>声明也必须核对，返回规范digest',async()=>{
  await expect(validateImplementationBindings({implementation_bindings:[{...binding,digest:`sha256:${'0'.repeat(64)}`}]},async()=>skill)).rejects.toThrow('digest');
  const [result]=await validateImplementationBindings({implementation_bindings:[binding]},async()=>skill);
  expect(result.digest).toBe(`sha256:${result.content_sha256}`);
});
