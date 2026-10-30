import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SKILL_SOURCE_ROOTS, SKILL_SOURCE_TESTS} from './skill-source-tests.mjs';
import {runSteps} from './run-basic-check.mjs';

const require = createRequire(import.meta.url);
const glob = require('fast-glob');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directories = SKILL_SOURCE_ROOTS;
try {
  const [component, ...extra] = process.argv.slice(2);
  if (extra.length || !Object.hasOwn(directories, component)) throw new Error('需要明确的Skill合同组件');
  const cwd = resolve(root, directories[component]);
  const selected = glob.sync(SKILL_SOURCE_TESTS[component], {cwd, ignore:['**/node_modules/**']});
  if (!selected.length) throw new Error('固定Skill合同集合为空');
  for (const path of SKILL_SOURCE_TESTS[component].filter(path => !path.includes('*'))) {
    if (!selected.includes(path)) throw new Error(`固定Skill合同文件缺失：${path}`);
  }
  process.stdout.write(`固定来源合同 ${component}：${selected.length} 个文件\n`);
  process.exitCode = runSteps([
    {cwd:root, command:'python3', args:['scripts/skills-source.py','verify']},
    {cwd, command:'npx', args:['--no-install','vitest','run','--config','vitest.skill-source.config.mjs','--reporter=dot']},
  ]);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
