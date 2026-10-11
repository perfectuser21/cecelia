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
it('本仓contract版本仅从已经固定的契约来源解析，读文件和记录均用实际SHA', async () => {
  const revision = 'b'.repeat(40), read = vi.fn(async () => 'export const run = true;\n');
  const declared = { kind: 'code', repo: 'org/repo', path: 'src/run.js', revision: 'contract' };
  const [result] = await validateImplementationBindings({ implementation_bindings: [declared] }, read, { repo: 'org/repo', commit: revision });
  expect(read.mock.calls[0][0].revision).toBe(revision);
  expect(result).toMatchObject({ revision, raw: declared, status: 'verified' });
  await expect(validateImplementationBindings({ implementation_bindings: [declared] }, read)).rejects.toThrow();
  await expect(validateImplementationBindings({ implementation_bindings: [declared] }, read, { repo: 'another/repo', commit: revision })).rejects.toThrow();
});

const verifySkill = (frontmatter, patch = {}) => validateImplementationBindings(
  { implementation_bindings: [{ ...binding, ...patch }] },
  async () => `---\n${frontmatter}\n---\n# 固定来源`,
);
it('Codex合法metadata.version作为版本来源，名称/声明/digest仍核真实SKILL.md', async () => {
  const [result] = await verifySkill('name: check\nmetadata:\n  version: 1.0.0');
  expect(result).toMatchObject({ name: 'check', version: '1.0.0', status: 'verified', validation_scope: 'reference_only' });
  expect(result.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  await expect(verifySkill('name: check\nmetadata:\n  version: 2.0.0')).rejects.toThrow('version不匹配');
});
it('顶层版本明确存在时优先，不被metadata覆盖', async () => {
  const frontmatter = 'name: check\nversion: 2.0.0\nmetadata:\n  version: 1.0.0';
  const [result] = await verifySkill(frontmatter, { version: '2.0.0' });
  expect(result.version).toBe('2.0.0');
  await expect(verifySkill(frontmatter)).rejects.toThrow('version不匹配');
});
it.each(['null', '""', '0', 'true', '{}', '[]', '.nan', '.inf'])('无效顶层版本%s不能静默降级到合法metadata.version', async version => {
  await expect(verifySkill(`name: check\nversion: ${version}\nmetadata:\n  version: 1.0.0`, { version: undefined })).rejects.toThrow('name/version');
});
it.each(['null', '""', '0', 'true', '{}', '[]', '.nan', '.inf'])('metadata版本%s遵守同一类型规则', async version => {
  await expect(verifySkill(`name: check\nmetadata:\n  version: ${version}`, { version: undefined })).rejects.toThrow('name/version');
});
it.each(['null', '""', '0', 'true', '{}', '[]'])('name必须非空字符串，拒绝%s', async name => {
  await expect(verifySkill(`name: ${name}\nversion: 1.0.0`, { name: undefined })).rejects.toThrow('name/version');
});
it.each(['name: check', 'version: 1.0.0', 'name: check\nmetadata: {}'])('名称或版本缺失仍拒绝：%s', async frontmatter => {
  await expect(verifySkill(frontmatter, { name: undefined, version: undefined })).rejects.toThrow('name/version');
});
it.each(['version: 2', 'metadata:\n  version: 2'])('正常旧数值版本与metadata数值版本均保留：%s', async version => {
  const [result] = await verifySkill(`name: check\n${version}`, { version: 2 });
  expect(result.version).toBe('2');
});
it.each(['skills/check/guide.md', 'skills/check/agents/openai.yaml', 'skills/check/catalog.json'])('metadata兼容不放宽真正Skill路径：%s', async path => {
  const read = vi.fn();
  await expect(validateImplementationBindings({ implementation_bindings: [{ ...binding, path }] }, read)).rejects.toThrow('Skill绑定必须指向SKILL.md');
  expect(read).not.toHaveBeenCalled();
});
