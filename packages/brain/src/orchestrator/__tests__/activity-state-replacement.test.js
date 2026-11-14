import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import state from '../activity-supervisor-state.cjs';
const roots=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'activity-state-replacement-'));roots.push(root);
 const file=path.join(root,'manifest.json');fs.writeFileSync(file,'{"pid":null}',{mode:0o600});
 return {root,file};
}
function replaceAfterOpen(file,replace){
 const original=fs.openSync,close=fs.closeSync,opened=[],closed=[];let injected=false,detached;
 vi.spyOn(fs,'openSync').mockImplementation((target,...args)=>{
  const fd=original(target,...args);
  if(target===file){opened.push(fd);if(!injected){injected=true;replace();detached=fs.fstatSync(fd).nlink;}}
  return fd;
 });
 vi.spyOn(fs,'closeSync').mockImplementation(fd=>{if(opened.includes(fd))closed.push(fd);return close(fd);});
 return {opened,closed,detached:()=>detached};
}
test('原子替换发生在open与fstat之间时重开当前manifest，不误杀监督进程',()=>{
 const {file}=fixture(),replacement=file+'.replacement';
 fs.writeFileSync(replacement,'{"pid":1234,"birth":"verified"}',{mode:0o600});
 const probe=replaceAfterOpen(file,()=>fs.renameSync(replacement,file));
 expect(state.protectedRead(file)).toEqual({pid:1234,birth:'verified'});
 expect(probe.detached()).toBe(0);expect(probe.opened.length).toBeGreaterThan(1);
 expect(probe.closed).toEqual(probe.opened);
});
test.each(['symlink','hardlink','wide-mode'])('重开仍拒绝不安全的替换文件：%s',kind=>{
 const {file}=fixture(),target=file+'.target',replacement=file+'.replacement';
 fs.writeFileSync(target,'{"pid":9999}',{mode:kind==='wide-mode'?0o644:0o600});
 if(kind==='symlink')fs.symlinkSync(target,replacement);
 else if(kind==='hardlink')fs.linkSync(target,replacement);
 else fs.renameSync(target,replacement);
 const probe=replaceAfterOpen(file,()=>fs.renameSync(replacement,file));
 expect(()=>state.protectedRead(file)).toThrow();expect(probe.detached()).toBe(0);
 expect(probe.closed).toEqual(probe.opened);
});
test('原文件仅被删除而未重新发布时拒绝，不返回脱链旧内容',()=>{
 const {file}=fixture(),probe=replaceAfterOpen(file,()=>fs.unlinkSync(file));
 expect(()=>state.protectedRead(file)).toThrow();expect(probe.detached()).toBe(0);
 expect(probe.closed).toEqual(probe.opened);
});
test('持续替换仍有界失败并关闭所有已打开的描述符',()=>{
 const {file}=fixture(),original=fs.openSync,close=fs.closeSync;let opened=0,closed=0;
 vi.spyOn(fs,'openSync').mockImplementation((target,...args)=>{
  const fd=original(target,...args);
  if(target===file){
   opened++;if(opened>10)throw Error('unbounded_reopen');
   const next=file+'.'+opened,writer=original(next,'wx',0o600);
   fs.writeSync(writer,'{"generation":'+opened+'}');close(writer);fs.renameSync(next,file);
  }
  return fd;
 });
 vi.spyOn(fs,'closeSync').mockImplementation(fd=>{closed++;return close(fd);});
 expect(()=>state.protectedRead(file)).toThrow('activity_state_file_replaced');
 expect(opened).toBeGreaterThan(1);expect(opened).toBeLessThanOrEqual(10);expect(closed).toBe(opened);
});
