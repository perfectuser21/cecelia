import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import yaml from 'js-yaml';
import {collectWorkspaceInputEdges} from '../../lib/existing-ops-workspace-source.js';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const paths=execFileSync('git',['ls-tree','-rz','--name-only',revision],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const cache=new Map(),read=p=>{if(!cache.has(p))cache.set(p,execFileSync('git',['show',`${revision}:${p}`],{cwd:root,encoding:'utf8'}));return cache.get(p);};
const ci='.github/workflows/ci.yml',config='packages/engine/vitest.config.ts';
const test='packages/engine/tests/skills/worktree-cleanup-set-e.test.ts',script='packages/engine/skills/dev/scripts/worktree-manage.sh';
const collect=overrides=>collectWorkspaceInputEdges({revision,paths,parse:t=>parse(t,{ecmaVersion:'latest',sourceType:'module'}),readSource:async p=>overrides?.[p]??read(p)});
it('真实固定Git CI→serial选择→实际spawn脚本输入，双端摘要完整',async()=>{
 const edges=await collect();
 for(const [src,dst] of [[ci,config],[config,test],[test,script]])expect(edges).toContainEqual(expect.objectContaining({src_path:src,dst_path:dst,detail:expect.objectContaining({source_revision:revision,consumer_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),input_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})}));
});
it('注释、条件、替身命令和改cwd不能证明CI执行',async()=>{
 for(const mutate of [s=>s.run='# '+s.run,s=>s.run='if false; then '+s.run+'; fi',s=>s.if='false',s=>s.run='echo vitest run',s=>s['working-directory']='other']){
  const doc=yaml.load(read(ci));mutate(doc.jobs['engine-tests'].steps.find(s=>s.name==='Unit Tests'));
  await expect(collect({[ci]:yaml.dump(doc)})).rejects.toThrow();
 }
});
it('未知selector或serial排除当前test不能认领脚本',async()=>{
 await expect(collect({[config]:read(config).replace("include: ['tests/**/*.test.ts'","include: [process.env.TESTS")})).rejects.toThrow();
 const edges=await collect({[config]:read(config).replaceAll("'**/node_modules/**',","'tests/skills/**', '**/node_modules/**',")});
 expect(edges.some(e=>e.dst_path===script)).toBe(false);
});
it('跳过、脚本替换、spawn替身、未调用函数和死分支不认领helper',async()=>{
 for(const text of [read(test).replaceAll('it.skipIf(!existsSync(SCRIPT))','it.skip').replaceAll('it.each(', 'it.skip.each('),
  read(test).replaceAll("[SCRIPT, 'cleanup']", "['other.sh', 'cleanup']").replaceAll("[SCRIPT, 'create'", "['other.sh', 'create'"),
  read(test).replaceAll('spawnSync(', 'fakeSpawn('),
  "import {it} from 'vitest'; import {spawnSync} from 'child_process'; const SCRIPT='other'; function unused(){spawnSync('bash',[SCRIPT]);} it('none',()=>{});",
  "import {it} from 'vitest'; import {spawnSync} from 'child_process'; it('dead',()=>{if(false){spawnSync('bash',['x.sh']);}}); // spawnSync('bash',['x.sh'])"]){
  const edges=await collect({[test]:text});expect(edges.some(e=>e.dst_path===script)).toBe(false);
 }
});
