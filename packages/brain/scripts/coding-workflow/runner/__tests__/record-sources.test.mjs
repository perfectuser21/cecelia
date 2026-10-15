import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFixCommits } from '../lib/pr-branch.mjs';
import { git } from '../../__tests__/helpers/git.mjs';
import { registerRecordSources, isRecordSourceDelta, RECORD_SOURCE_MANIFEST as M, RECORD_SOURCE_OWNER as OWNER } from '../../lib/record-sources.mjs';
const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431', branch = 'cp-10121524-cw-088c3431';
const intent = { taskId, sprintDir, stage: 'qa', round: 1 }, report = `${sprintDir}/05-qa-report-r1.md`;
let root, original;
const put = (file, text = 'record\n') => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });fs.writeFileSync(path.join(root, file), text); };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const commit = () => { git(root, 'add', '.');git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'); };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-sources-'));
  git(root, 'init', '-qb', branch);git(root, 'config', 'user.name', 'fixture');git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
  put(OWNER, '// actual runner is executable\n');fs.chmodSync(path.join(root, OWNER), 0o755);
  put('README.md');put(`${sprintDir}/01-intent.md`, `---\ntask_id: ${taskId}\nstep: intent\nupstream: []\n---\n`);
  original = '{\n "repo":"perfectuser21/cecelia", "relations": [\n  { "path": "README.md", "role":"documentation", "owner_path":"'+OWNER+'" }\n ], "schema_version":1\n}\n';
  put(M, original);commit();git(root,'update-ref','refs/remotes/origin/main','HEAD');put(report);
});
afterEach(() => { vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true}); });
it('可执行真实runner作owner；仅前置插入当前报告，保留旧条目字节并可重启幂等', () => {
  expect(registerRecordSources(root,intent,[report])).toEqual([M]);const once=read(M);
  expect(once.replace(/\n    \{"owner_path"[^\n]+\},/, '')).toBe(original);
  expect(registerRecordSources(root,intent,[report])).toEqual([M]);expect(read(M)).toBe(once);
  commit();expect(registerRecordSources(root,intent,[report])).toEqual([]);expect(read(M)).toBe(once);
});
it.each(['identity','sprint','branch','repo','link','executable','unknown','other-round','conflict','modified','staged','missing','invalid'])(
  '%s 拒绝登记且保留原现场', kind => {
    const options={...intent};let files=[report];
    if(kind==='identity')options.taskId='aaaaaaaa-0000-0000-0000-000000000000';
    if(kind==='sprint')options.sprintDir='sprints/10121524-cw-aaaaaaaa';
    if(kind==='branch')git(root,'checkout','-b','cp-10121524-cw-deadbeef');
    if(kind==='repo')git(root,'remote','set-url','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
    if(kind==='link'){fs.unlinkSync(path.join(root,report));fs.symlinkSync(path.join(root,'README.md'),path.join(root,report));}
    if(kind==='executable')fs.chmodSync(path.join(root,report),0o755);
    if(kind==='unknown'){const p=`${sprintDir}/qa-r1/evidence.json`;put(p,'{"real":"evidence"}');files=[report,p];}
    if(kind==='other-round'){const p=`${sprintDir}/05-qa-report-r2.md`;put(p);files=[p];}
    if(kind==='conflict'){const d=JSON.parse(original);d.relations.push({path:report,role:'documentation',owner_path:'other.mjs'});put(M,JSON.stringify(d));commit();}
    if(kind==='modified')put(M,original+' ');
    if(kind==='staged'){put(M,original+' ');git(root,'add',M);}
    if(kind==='missing')fs.unlinkSync(path.join(root,M));
    if(kind==='invalid'){put(M,'{}');commit();}
    const before=fs.existsSync(path.join(root,M))?read(M):null;
    expect(()=>registerRecordSources(root,options,files)).toThrow();
    expect(fs.existsSync(path.join(root,M))?read(M):null).toBe(before);
    expect(fs.existsSync(path.join(root,files.at(-1)))).toBe(true);
  });
it('rename失败不损坏旧manifest；恢复后同输入可重试且不留临时文件', () => {
  const rename=vi.spyOn(fs,'renameSync').mockImplementationOnce(()=>{throw Error('injected rename failure');});
  expect(()=>registerRecordSources(root,intent,[report])).toThrow('injected rename failure');expect(read(M)).toBe(original);
  rename.mockRestore();expect(registerRecordSources(root,intent,[report])).toEqual([M]);
  expect(fs.readdirSync(root).filter(f=>f.startsWith(M+'.'))).toEqual([]);
});
it('三视图仅允许准确新增记录关系；旧关系篡改或额外scope声明仍拒绝', () => {
  const base=git(root,'rev-parse','HEAD').trim();registerRecordSources(root,intent,[report]);
  expect(isRecordSourceDelta(root,{from:':',to:null,branch})).toBe(true);
  git(root,'add','--',M,report);expect(isRecordSourceDelta(root,{from:'HEAD',to:':',branch})).toBe(true);
  commit();expect(isRecordSourceDelta(root,{from:base,to:'HEAD',branch})).toBe(true);
  const d=JSON.parse(read(M));d.relations.find(r=>r.path==='README.md').owner_path='other.mjs';put(M,JSON.stringify(d));
  expect(isRecordSourceDelta(root,{from:':',to:null,branch})).toBe(false);
});
it('commander只登记真实本轮07；不能借入口给QA或异轮记录认领', () => {
  const file=`${sprintDir}/07-commander-r2.md`;put(file);
  expect(registerRecordSources(root,{...intent,stage:'commander',round:2},[file])).toEqual([M]);
  expect(()=>registerRecordSources(root,{...intent,stage:'commander',round:2},[report])).toThrow('record_source_file_unsupported');
});

it('多次控制器提交的前部插入可重算；模型已提交的旧owner篡改不能被HEAD洗白', () => {
  registerRecordSources(root,intent,[report]);commit();
  const judge=`${sprintDir}/06-judge-r1.md`;put(judge);
  expect(registerRecordSources(root,intent,[judge])).toEqual([M]);commit();
  const commander=`${sprintDir}/07-commander-r1.md`;put(commander);
  expect(registerRecordSources(root,{...intent,stage:'commander'},[commander])).toEqual([M]);commit();
  const data=JSON.parse(read(M));data.relations.find(r=>r.path==='README.md').owner_path='other.mjs';put(M,JSON.stringify(data));commit();
  expect(()=>registerRecordSources(root,intent,[report])).toThrow('record_source_committed_manifest_modified');
});

it('模型修复提交不得修改控制器来源索引，即使已经commit也拒绝', async () => {
  fs.unlinkSync(path.join(root,report));const before=git(root,'rev-parse','HEAD').trim();
  put(M,original+' ');commit();git(root,'remote','remove','origin');
  await expect(checkFixCommits(root,before)).rejects.toThrow('protected_path');
});
