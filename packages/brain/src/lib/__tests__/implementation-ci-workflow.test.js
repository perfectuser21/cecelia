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
 const commands=commandsFor('brain-integration');
 const pg=commands.filter(row=>row.command==='npx'&&row.args.includes('vitest'));
 expect(pg).toHaveLength(1);
 expect(pg[0].cwd).toBe(join(root,'packages/brain'));
 expect(pg[0].args.slice(0,5)).toEqual(['--no-install','vitest','run','--config','../../scripts/ci/deep-integration.config.mjs']);
 expect(pg[0].ciScratchDatabase).toBe(true);
});
