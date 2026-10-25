---
task_id: a4420767-a098-47e1-96ee-710eb033dd85
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS
```command
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { validatePlan } from './packages/brain/scripts/coding-workflow/new-task.mjs';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md', 'utf8');
const cli = fs.readFileSync('packages/brain/scripts/coding-workflow/new-task.mjs', 'utf8');
const section = readme.split('### 单任务\n')[1]?.split('### 两任务批次\n')[0];
assert(section, '单任务小节缺失');
const fence = String.fromCharCode(96).repeat(3);
const plan = JSON.parse(section.split(fence + 'json\n')[1].split('\n' + fence)[0]);
for (const key of ['title', 'change_kind', 'map_scope_hint', 'acceptance', 'repo', 'gp_anchor']) assert(Object.hasOwn(plan, key), key);
assert.equal(plan.repo, 'cecelia');
assert.equal(plan.gp_anchor, 'none(docs)');
assert.deepEqual(validatePlan(plan).errors, []);
assert(section.includes('new-task.mjs <单任务计划.json> --repo cecelia --dry-run'));
assert(section.includes('不创建 Brain 任务') && section.includes('不证明运行成功'));
assert(section.includes('任务自身 `repo` → 计划顶层 `repo` → `--repo` → 默认 `cecelia`'));
assert(section.includes('40 位小写十六进制格式') && section.includes('不检查提交是否存在'));
assert(cli.includes('if (dryRun) {') && cli.includes('return 0;') && cli.includes('/^[a-f0-9]{40}$/'));
console.log('I-1 PASS：单任务 JSON 字段齐全，validatePlan 无错误；README 的 dry-run、仓库优先级和 base_sha 边界与 CLI 源码相符');
JS
```
```output
I-1 PASS：单任务 JSON 字段齐全，validatePlan 无错误；README 的 dry-run、仓库优先级和 base_sha 边界与 CLI 源码相符
```

### E-2
对应: I-2
verdict: PASS
```command
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { validatePlan } from './packages/brain/scripts/coding-workflow/new-task.mjs';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md', 'utf8');
const deps = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/lib/deps.mjs', 'utf8');
const section = readme.split('### 两任务批次\n')[1]?.split('### 真实提交与失败核账\n')[0];
assert(section, '两任务批次小节缺失');
const fence = String.fromCharCode(96).repeat(3);
const plan = JSON.parse(section.split(fence + 'json\n')[1].split('\n' + fence)[0]);
assert.equal(plan.tasks.length, 2);
assert.equal(Boolean(plan.project_id) !== Boolean(plan.project), true);
assert.deepEqual(plan.tasks[1].depends_on, [plan.tasks[0].key]);
assert.deepEqual(validatePlan(plan).errors, []);
for (const [name, change, expected] of [
  ['前向未知依赖', p => p.tasks[0].depends_on = ['不存在'], 'depends_on_unknown'],
  ['重复 key', p => p.tasks[1].key = p.tasks[0].key, 'key_duplicate'],
  ['项目冲突', p => p.project_id = 'existing', 'project_conflict'],
  ['依赖无项目', p => delete p.project, 'project_required'],
]) {
  const copy = structuredClone(plan); change(copy);
  assert(validatePlan(copy).errors.some(e => e.includes(expected)), name);
}
for (const phrase of ['前向或未知依赖', '重复 `key`', '`project_id` 与 `project` 同给', '带依赖却无项目', 'status=completed', '无 PR URL', 'result.merged=true', '`MERGED` 就绪', '`CLOSED` 拒绝']) assert(section.includes(phrase), phrase);
for (const phrase of ["task.status !== 'completed'", 'if (!url || task.result?.merged === true)', "if (pr === 'MERGED')", "if (pr === 'CLOSED')"]) assert(deps.includes(phrase), phrase);
console.log('I-2 PASS：两任务示例有效，四类无效批次均被 validatePlan 拒绝；依赖状态分支与 deps.mjs 相符');
JS
```
```output
I-2 PASS：两任务示例有效，四类无效批次均被 validatePlan 拒绝；依赖状态分支与 deps.mjs 相符
```

### E-3
对应: I-3
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
import subprocess
readme_path = 'packages/brain/scripts/coding-workflow/runner/README.md'
readme = Path(readme_path).read_bytes()
base = subprocess.check_output(['git', 'show', '9834f4852ce3436252222b1fdfaf9d72e72bad24:' + readme_path])
pos = 0
for line in base.splitlines(keepends=True):
    found = readme.find(line, pos)
    if found < 0:
        raise SystemExit('FAIL：基线 README 原字节或顺序缺失：' + repr(line[:100]))
    pos = found + len(line)
text = readme.decode()
cli = Path('packages/brain/scripts/coding-workflow/new-task.mjs').read_text()
section = text.split('### 真实提交与失败核账\n')[1].split('## 运行回执如何判读\n')[0]
for phrase in ['去掉 `--dry-run` 才会写入 Brain', 'POST /api/brain/projects', 'POST /api/brain/tasks', '失败对象 ID', '盲目整批重跑', '逐 ID 只读查 Brain']:
    assert phrase in section, phrase
assert '已建：' in section and 'task_route_mismatch' in section
assert 'if (dryRun)' in cli and 'postJson(`${base}/tasks`' in cli
assert '## 运行回执如何判读' in text
assert '### 误读三：回执 completed 或前置 completed 等于全链成功' in text
assert 'ZenithJoy' in text and '人工合并' in text
print(f'I-3 PASS：基线 README {len(base)} 字节按原字节和顺序保留；提交、失败核账、A11 回执判读及安全边界可见')
PY
```
```output
I-3 PASS：基线 README 17967 字节按原字节和顺序保留；提交、失败核账、A11 回执判读及安全边界可见
```

### E-4
对应: I-4
verdict: PASS
```command
python3 - <<'PY'
import subprocess
from pathlib import Path
base = '9834f4852ce3436252222b1fdfaf9d72e72bad24'
readme = 'packages/brain/scripts/coding-workflow/runner/README.md'
manifest = '.implementation-source-relations.json'
sprint = 'sprints/10251706-cw-a4420767/'
def git(*args):
    return subprocess.check_output(['git', *args], text=True).splitlines()
head = git('diff', '--name-only', base, 'HEAD')
staged = git('diff', '--name-only', '--cached')
worktree = git('diff', '--name-only')
untracked = git('ls-files', '--others', '--exclude-standard')
print('base→HEAD:', head)
print('暂存区:', staged)
print('工作区:', worktree)
print('全仓未跟踪:', untracked)
allowed = {'01-intent.md', '01-invariants.md', '02-spec.md', '02-review.md', '04-evidence.md'}
assert head == [readme], '基线到 HEAD 存在其它产品改动'
assert staged == [] and worktree == [], '暂存区或工作区存在改动'
assert all(p.startswith(sprint) and (p[len(sprint):] in allowed or p[len(sprint):].startswith(('02-review-r', '02-response-r')) and p.endswith('.md')) for p in untracked), '存在越界未跟踪文件'
assert git('diff', '--name-only', base, 'HEAD', '--', manifest) == [], 'manifest 相对基线已改'
baseline = subprocess.check_output(['git', 'show', f'{base}:{readme}'])
current = Path(readme).read_bytes()
position = 0
for line in baseline.splitlines(keepends=True):
    found = current.find(line, position)
    assert found >= 0, '基线 README 原文缺失'
    position = found + len(line)
print('I-4 PASS：产品仅 README；基线原文字节有序保留；manifest 零差异；未跟踪仅当前任务流水线记录')
PY
```
```output
base→HEAD: ['packages/brain/scripts/coding-workflow/runner/README.md']
暂存区: []
工作区: []
全仓未跟踪: ['sprints/10251706-cw-a4420767/01-intent.md', 'sprints/10251706-cw-a4420767/01-invariants.md', 'sprints/10251706-cw-a4420767/02-response-r1.md', 'sprints/10251706-cw-a4420767/02-response-r2.md', 'sprints/10251706-cw-a4420767/02-review-r1.md', 'sprints/10251706-cw-a4420767/02-review-r2.md', 'sprints/10251706-cw-a4420767/02-review-r3.md', 'sprints/10251706-cw-a4420767/02-review.md', 'sprints/10251706-cw-a4420767/02-spec.md']
I-4 PASS：产品仅 README；基线原文字节有序保留；manifest 零差异；未跟踪仅当前任务流水线记录
```
