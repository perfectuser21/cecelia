---
task_id: 889f9288-5169-4341-acb8-f5cacc330bff
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text()
s=Path('packages/brain/scripts/coding-workflow/runner/status.mjs').read_text()
for x in ('status.mjs --log-dir <回执目录> --json','status.mjs --log-dir <回执目录>','CODING_WF_LOG_DIR','mtime','倒序','[]','不能证明服务健康'):
    assert x in r, x
for x in ("if (argv[i] === '--log-dir')","else if (argv[i] === '--json')","rows.sort((a, b) => b.mtimeMs - a.mtimeMs)","if (!rows.length) return EMPTY_HINT"):
    assert x in s, x
print('I-1 PASS: README 参数、mtime 倒序和空结果说明均存在；status.mjs 对应实现存在')
PY
```
```output
I-1 PASS: README 参数、mtime 倒序和空结果说明均存在；status.mjs 对应实现存在
```

### E-2
对应: I-2
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text()
s=Path('packages/brain/scripts/coding-workflow/runner/status.mjs').read_text()
p=Path('packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs').read_text()
for x in ('running','completed','partial','failed','unreadable','ci_fix.attempts','ci_fix.last_result','pr-sync-pending.json','QA','Commander','不能证明文件损坏','不是删除待办或现场的依据'):
    assert x in r, x
for x in ("'last_event' in receipt","status: 'running'","status: 'unreadable'","FINAL_STATUSES.has(receipt.status)","CIFIX_STATE_RE = /^cifix-\\d+\\.json$/","last_result: attempts[attempts.length - 1]?.result"):
    assert x in s, x
for x in ("new Set(['completed', 'partial', 'failed'])","failed?.key ?? null","attemptReason || failed?.reason_code || receipt?.reason_code"):
    assert x in p, x
print('I-2 PASS: README 五种状态、CI 修复摘要和非回执 JSON 提示与源码对应')
PY
```
```output
I-2 PASS: README 五种状态、CI 修复摘要和非回执 JSON 提示与源码对应
```

### E-3
对应: I-3
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text()
s=Path('packages/brain/scripts/coding-workflow/runner/status.mjs').read_text()
p=Path('packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs').read_text()
for x in ('只是执行器回执，不是最终合并结论','reason_code=pr_url_missing','pr_url=null','文本的 completed 行默认不打印该原因','最终 head','已合并状态','runner.phase=merged','merge.merged=true','QA 终态','不手工改批准或 FAIL 记录'):
    assert x in r, x
assert "return { status: 'completed', failed_activity: null, reason_code: prUrl ? null : 'pr_url_missing', pr_url: prUrl, ...cost }" in p
assert "const tail = r.status === 'completed'" in s and "? (r.pr_url ?? '')" in s
print('I-3 PASS: README 区分 completed 与合并，列出 PR/head、Brain 和 QA 核对；源码支持缺 PR URL 边界')
PY
```
```output
I-3 PASS: README 区分 completed 与合并，列出 PR/head、Brain 和 QA 核对；源码支持缺 PR URL 边界
```

### E-4
对应: I-4
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
import re, subprocess
base='6073eac1d35e652e3ea6b71fc040878c95864cd7'
readme='packages/brain/scripts/coding-workflow/runner/README.md'
manifest='.implementation-source-relations.json'
def git(*args):
    return subprocess.check_output(['git',*args]).decode().splitlines()
head=set(git('diff','--name-only',base,'HEAD'))
staged=set(git('diff','--cached','--name-only'))
work=set(git('diff','--name-only'))
untracked=git('ls-files','--others','--exclude-standard')
pattern=re.compile(r'^sprints/10161848-cw-889f9288/(?:01-intent|01-invariants|02-spec|02-review(?:-r[1-9][0-9]*)?|02-response-r[1-9][0-9]*|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md$')
records=[p for p in untracked if pattern.fullmatch(p)]
product=head|staged|work|(set(untracked)-set(records))
assert product=={readme}, sorted(product)
old=subprocess.check_output(['git','show',f'{base}:{readme}']).splitlines(keepends=True)
new=Path(readme).read_bytes().splitlines(keepends=True)
it=iter(new)
assert all(any(line==candidate for candidate in it) for line in old), '基线 README 原文或顺序改变'
assert manifest not in product, 'manifest 已改'
assert subprocess.check_output(['git','show',f'{base}:{manifest}'])==Path(manifest).read_bytes(), 'manifest 字节改变'
print('I-4 PASS: 基线到 HEAD、暂存区、工作区及全仓未跟踪文件已检查')
print('产品改动:', ', '.join(sorted(product)))
print('排除的本任务流水线记录:', ', '.join(records))
print('基线 README 原文逐行保留且顺序一致；manifest 与基线逐字相同')
PY
```
```output
I-4 PASS: 基线到 HEAD、暂存区、工作区及全仓未跟踪文件已检查
产品改动: packages/brain/scripts/coding-workflow/runner/README.md
排除的本任务流水线记录: sprints/10161848-cw-889f9288/01-intent.md, sprints/10161848-cw-889f9288/01-invariants.md, sprints/10161848-cw-889f9288/02-response-r1.md, sprints/10161848-cw-889f9288/02-review-r1.md, sprints/10161848-cw-889f9288/02-review-r2.md, sprints/10161848-cw-889f9288/02-review.md, sprints/10161848-cw-889f9288/02-spec.md
基线 README 原文逐行保留且顺序一致；manifest 与基线逐字相同
```
