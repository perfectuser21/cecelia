import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

it('主CI集成入口安装根扫描器与Brain锁依赖，不能被子workspace安装裁剪',async()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
 const steps=workflow.jobs.checks.steps;
 const tests=steps.findIndex(s=>s.run?.includes('node scripts/ci/run-basic-check.mjs'));
 const installs=steps.slice(0,tests).filter(s=>!s.if&&/npm ci/.test(s.run||''));
 expect(installs.length).toBeGreaterThan(0);
 expect(installs.at(-1)['working-directory']||'.').toBe('.');
 expect(installs.at(-1).run.trim()).toMatch(/^npm ci(?: --(?:ignore-scripts|no-audit|no-fund))*$/);
 expect(steps[tests].run).toContain('scripts/ci/run-basic-check.mjs');
 const {commandsFor}=await import('../../../../../scripts/ci/run-basic-check.mjs');
 const root=join(fileURLToPath(new URL('../../../../../',import.meta.url)),'.');
 expect(commandsFor('brain-integration')).toEqual([
  {cwd:root,command:'node',args:['scripts/ci/basic-runtime-smoke.mjs','--validate-only']},
  {cwd:join(root,'packages/brain'),command:'node',args:['src/migrate.js']},
  {cwd:join(root,'packages/brain'),command:'npx',args:[
   '--no-install','vitest','run','--config','../../scripts/ci/deep-integration.config.mjs',
   'src/__tests__/integration/task-lease-device-pool.pg.integration.test.js',
   'src/__tests__/integration/executor-startup-headed-owner.pg.integration.test.js',
   'src/__tests__/integration/suggestion-plan-callback.pg.integration.test.js',
   'src/__tests__/integration/managed-script-profile.pg.integration.test.js',
   'src/__tests__/integration/workflow-common-terminal.pg.integration.test.js','--reporter=dot',
  ],ciScratchDatabase:true},
  {cwd:root,command:'node',args:['--test','scripts/ci/__tests__/runtime-signal.integration.test.mjs']},
  {cwd:root,command:'node',args:['scripts/ci/basic-runtime-smoke.mjs']},
 ]);
});
