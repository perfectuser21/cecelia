import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

it('固定历史fixture拒绝本机虽有对象但未合入main的提交',async()=>{
 const root=mkdtempSync(join(tmpdir(),'fixed-fixture-main-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).trim();
 try{
  git('init','-q');
  const tree=execFileSync('git',['mktree'],{cwd:root,encoding:'utf8',input:''}).trim();
  const main=git('commit-tree',tree,'-m','merged main fixture');
  const unmerged=git('commit-tree',tree,'-p',main,'-m','unmerged PR fixture');
  git('update-ref','refs/remotes/origin/main',main);
  expect(git('cat-file','-t',unmerged)).toBe('commit');
  const target=join(root,'packages/brain/src/lib/__tests__/helpers/fixed-existing-ops-git-fixture.js');
  mkdirSync(dirname(target),{recursive:true});
  copyFileSync(fileURLToPath(new URL('./helpers/fixed-existing-ops-git-fixture.js',import.meta.url)),target);
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  const {readFixedExistingOpsGitFixture}=await import(pathToFileURL(target).href);
  expect(readFixedExistingOpsGitFixture(main).revision).toBe(main);
  expect(()=>readFixedExistingOpsGitFixture(unmerged)).toThrow('fixed Git fixture must be merged into origin/main');
 }finally{rmSync(root,{recursive:true,force:true});}
});
