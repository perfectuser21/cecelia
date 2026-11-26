import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';

// Dashboard近期停用后没有默认浏览器job预算；保留现有独立CLI完整构建和验收。
const workflow=yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
const dashboard=JSON.parse(readFileSync(new URL('../../../apps/dashboard/package.json',import.meta.url),'utf8'));
test('停用前端不在默认CI安装Chromium或重复构建浏览器产物',()=>{
 assert.equal(workflow.jobs['pwa-upgrade'],undefined);
 assert.ok(workflow.jobs.checks.strategy.matrix.include.every(row=>row.component!=='dashboard'));
 for(const job of Object.values(workflow.jobs))for(const step of job.steps??[])assert.doesNotMatch(step.run??'',/playwright-cli\.mjs install chromium|vite build --outDir \.dist-pwa-e2e/);
});
test('独立PWA与交办台CLI保留真实build和Playwright执行，非默认假成功',()=>{
 assert.equal(dashboard.scripts['test:pwa-upgrade'],'GIT_SHA=pwa-upgrade-e2e vite build --outDir .dist-pwa-e2e && node e2e/playwright-cli.mjs test e2e/pwa-upgrade.spec.ts');
 assert.equal(dashboard.scripts['test:task-desk'],'GIT_SHA=task-desk-e2e vite build --outDir .dist-task-desk-e2e && node e2e/playwright-cli.mjs test e2e/task-desk.spec.ts');
});
