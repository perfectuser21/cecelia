import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

it('候选HEAD读取真实Git树，历史fixture始终拒绝未合main提交',async()=>{
 const root=mkdtempSync(join(tmpdir(),'fixed-fixture-main-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).trim();
 try{
  git('init','-q');
  const treeFor=text=>{
   const blob=execFileSync('git',['hash-object','-w','--stdin'],{cwd:root,encoding:'utf8',input:text}).trim();
   return execFileSync('git',['mktree'],{cwd:root,encoding:'utf8',input:`100644 blob ${blob}\tfixture.txt\n`}).trim();
  };
  const main=git('commit-tree',treeFor('main bytes\n'),'-m','merged main fixture');
  const unmerged=git('commit-tree',treeFor('candidate bytes\n'),'-p',main,'-m','unmerged PR fixture');
  git('update-ref','refs/remotes/origin/main',main);
  expect(git('cat-file','-t',unmerged)).toBe('commit');
  const target=join(root,'packages/brain/src/lib/__tests__/helpers/fixed-existing-ops-git-fixture.js');
  mkdirSync(dirname(target),{recursive:true});
  for(const name of ['fixed-existing-ops-git-fixture.js','current-existing-ops-git-fixture.js','read-existing-ops-git-tree.js'])copyFileSync(fileURLToPath(new URL('./helpers/'+name,import.meta.url)),join(dirname(target),name));
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  const {readFixedExistingOpsGitFixture}=await import(pathToFileURL(target).href);
  expect(readFixedExistingOpsGitFixture(main).read('fixture.txt')).toBe('main bytes\n');
  git('update-ref','HEAD',unmerged);
  writeFileSync(join(root,'fixture.txt'),'dirty workspace bytes\n');
  const {readCurrentExistingOpsGitFixture}=await import(pathToFileURL(join(dirname(target),'current-existing-ops-git-fixture.js')).href);
  const current=readCurrentExistingOpsGitFixture();
  expect(current.revision).toBe(unmerged);
  expect(current.tree).toBe(git('rev-parse',unmerged+'^{tree}'));
  expect(current.paths).toEqual(['fixture.txt']);
  expect(current.entries[0].sha).toBe(git('rev-parse',unmerged+':fixture.txt'));
  expect(current.read('fixture.txt')).toBe('candidate bytes\n');
  git('update-ref','HEAD',main);
  expect(readCurrentExistingOpsGitFixture().read('fixture.txt')).toBe('main bytes\n');
  expect(()=>readFixedExistingOpsGitFixture(unmerged)).toThrow('fixed Git fixture must be merged into origin/main');
 }finally{rmSync(root,{recursive:true,force:true});}
});
