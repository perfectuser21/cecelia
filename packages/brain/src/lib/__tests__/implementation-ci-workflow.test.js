import { describe,expect,it } from 'vitest';
import { readFileSync,existsSync } from 'node:fs';
import yaml from 'js-yaml';
describe('implementation-ci-workflow',()=>{
it('实际PR/main触发存在，中央凭据只在main快照job，回归job不持Brain token',()=>{
  const path=new URL('../../../../../.github/workflows/implementation-impact.yml',import.meta.url);
  expect(existsSync(path),'不能只交CLI测试，必须有实际workflow').toBe(true);
  const workflow=yaml.load(readFileSync(path,'utf8'));
  expect(workflow.on.pull_request.branches).toContain('main');expect(workflow.on.push.branches).toContain('main');
  expect(workflow.jobs['snapshot-main'].if).toContain("github.event_name != 'pull_request'");
  expect(JSON.stringify(workflow.jobs['snapshot-main'])).toContain('CECELIA_INTERNAL_TOKEN');
  expect(JSON.stringify(workflow.jobs.gate)).not.toContain('CECELIA_INTERNAL_TOKEN');
  expect(JSON.stringify(workflow.jobs.gate)).toContain('implementation-pr-gate.mjs');
});

});
