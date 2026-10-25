---
task_id: df525426-c735-44d1-abee-82023053fd93
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
r = Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text()
t = Path('packages/brain/scripts/coding-workflow/runner/lib/terminal.mjs').read_text()
m = Path('packages/brain/scripts/coding-workflow/runner/lib/merge-gate.mjs').read_text()
checks = {
    'completed 后 cfg.automerge 才早期 ready': "status: 'completed'" in t and 'if (cfg.automerge)' in t and "['pr', 'ready', prUrl]" in t,
    'QA 开启 awaiting_qa 与关闭 awaiting_manual_merge': "phase: cfg.qaGate ? 'awaiting_qa' : 'awaiting_manual_merge'" in t and 'awaiting_qa' in r and 'awaiting_manual_merge' in r,
    'merge-gate 精确批准与 required/source': 's.approved.head' in m and 'requiredState(cfg, pr.number)' in m and 'verifyMergeSource(cfg, pr, s.approved.round)' in m and '精确 QA 与独立 judge' in r,
    'ready 前后只读校验': "['pr', 'view', String(pr.number), '--json', 'headRefOid,isDraft,state']" in m and 'const before = await current()' in m and 'const after = await current()' in m and 'ready 本身没有 head CAS' in r,
    '最终 merge CAS 与人工路径': "'--match-head-commit', s.approved.head" in m and 'cfg.repoAutomerge === false' in m and 'awaiting_human' in r,
}
for name, ok in checks.items():
    assert ok, name
    print(name + ': 成立')
PY
```

```output
completed 后 cfg.automerge 才早期 ready: 成立
QA 开启 awaiting_qa 与关闭 awaiting_manual_merge: 成立
merge-gate 精确批准与 required/source: 成立
ready 前后只读校验: 成立
最终 merge CAS 与人工路径: 成立
```

### E-2
对应: I-2
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
r = Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text()
m = Path('packages/brain/scripts/coding-workflow/runner/lib/merge-gate.mjs').read_text()
checks = {
    '四种 SHA 身份分别说明': all(x in r for x in ['`tested_head`', '`approved.head`', '`headRefOid`', '`mergeCommit`']),
    '旧 HEAD 检查不可复用': '旧 head 的 QA/CI 结果当作新 head 的执行证据' in r and '重新真实 QA、judge、正式 CI 和 preview' in r,
    '记录提交改绑有受保护来源': '05/06 纯登记提交' in r and '真实 protected source 链' in r and 'approved.head` 绑定登记 HEAD' in r,
    'main 同步需完整来源': '准确双父、actual main ref、全树与 source gate' in r,
    '代码执行源门及 head CAS': 'verifyMergeSource(cfg, pr, s.approved.round)' in m and "'--match-head-commit', s.approved.head" in m,
    's.merged.head 与 squash SHA 区分': '不能把 `s.merged.head` 冒充 `mergeCommit`' in r and 's.merged = { head: s.approved.head' in m,
}
for name, ok in checks.items():
    assert ok, name
    print(name + ': 成立')
PY
```

```output
四种 SHA 身份分别说明: 成立
旧 HEAD 检查不可复用: 成立
记录提交改绑有受保护来源: 成立
main 同步需完整来源: 成立
代码执行源门及 head CAS: 成立
s.merged.head 与 squash SHA 区分: 成立
```

### E-3
对应: I-3
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
import subprocess
p = 'packages/brain/scripts/coding-workflow/runner/README.md'
r = Path(p).read_text()
m = Path('packages/brain/scripts/coding-workflow/runner/lib/merge-gate.mjs').read_text()
l = Path('packages/brain/scripts/coding-workflow/runner/lib/merge-learning.mjs').read_text()
base = subprocess.check_output(['git', 'show', '0bd461e8c80fc5db202e2570eeee77d0c9cdce58:' + p])
now = Path(p).read_bytes()
checks = {
    'README 固定基线原字节完整前缀': now.startswith(base) and len(now) > len(base),
    'MERGED 后双 pending 与 Brain 回执': 'receipt_pending: true, learning_pending: true' in m and 'merge: { merged: true' in m and "phase: 'merged'" in m and 'handoff: mergedHandoff' in m,
    'Learning 先记尝试再 POST': 'learning_attempted: true, learning_status: \'unknown\'' in l and l.index('learning_attempted: true') < l.index('postLearnings(body)'),
    'Learning ID 与全文哈希读回': 'new Set(ids).size === ids.length' in l and "createHash('sha256')" in l and 'found.get(id) === hashes[i]' in l,
    'pending、next tick、preview 与旧失败均有边界': all(x in r for x in ['next tick', 'preview stop', '旧 FAIL/HUMAN', 'status=completed', '不自动重发']),
}
for name, ok in checks.items():
    assert ok, name
    print(name + ': 成立')
PY
```

```output
README 固定基线原字节完整前缀: 成立
MERGED 后双 pending 与 Brain 回执: 成立
Learning 先记尝试再 POST: 成立
Learning ID 与全文哈希读回: 成立
pending、next tick、preview 与旧失败均有边界: 成立
```

### E-4
对应: I-4
verdict: PASS

```command
python3 - <<'PY'
from pathlib import Path
import subprocess
base = '0bd461e8c80fc5db202e2570eeee77d0c9cdce58'
p = 'packages/brain/scripts/coding-workflow/runner/README.md'
def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()
head = git('rev-parse', 'HEAD')
subprocess.check_call(['git', 'merge-base', '--is-ancestor', base, head])
dag = [line.split() for line in git('rev-list', '--parents', base + '..' + head).splitlines()]
assert dag and all(len(row) >= 2 for row in dag)
for row in dag:
    for parent in row[1:]:
        raw = git('diff-tree', '-r', '--raw', parent, row[0])
        assert raw and raw == git('diff', '--raw', '--abbrev=40', parent, row[0])
        print('父边 ' + parent[:12] + '→' + row[0][:12] + ': ' + raw)
changed = git('diff', '--name-only', base, head).splitlines()
assert changed == [p], changed
assert git('diff', '--cached', '--raw') == ''
assert git('diff', '--raw') == ''
untracked = git('ls-files', '--others', '--exclude-standard').splitlines()
assert all(x.startswith('sprints/10260429-cw-df525426/') for x in untracked), untracked
base_mode = git('ls-tree', base, p).split()[0]
head_mode = git('ls-tree', head, p).split()[0]
assert base_mode == head_mode == '100644'
base_bytes = subprocess.check_output(['git', 'show', base + ':' + p])
assert Path(p).read_bytes().startswith(base_bytes)
r = Path(p).read_text()
for x in ['| build |', '| 发布前 verify |', '| 当前 QA |', '| judge-only `historical_execution` |', '| 外层终验 |', '内存反例', 'C01-C12', 'A 的旧信用不替代 B']:
    assert x in r, x
print('固定基线=' + base + ' 当前HEAD=' + head)
print('全差异仅 README；mode=100644；基线字节为前缀；index/worktree 均空')
print('全仓未跟踪=' + ', '.join(untracked))
print('阶段分工与 C01-C12 边界：成立')
PY
```

```output
父边 0bd461e8c80f→4432f485481f: :100644 100644 66e0b30550907c3735833366a590f7630bd2def4 ddeeebc90da8ade9a6069f57c554f2bcbb586e14 M	packages/brain/scripts/coding-workflow/runner/README.md
固定基线=0bd461e8c80fc5db202e2570eeee77d0c9cdce58 当前HEAD=4432f485481f2b37f15ea01ba238ca278f90af13
全差异仅 README；mode=100644；基线字节为前缀；index/worktree 均空
全仓未跟踪=sprints/10260429-cw-df525426/01-intent.md, sprints/10260429-cw-df525426/01-invariants.md, sprints/10260429-cw-df525426/02-response-r1.md, sprints/10260429-cw-df525426/02-review-r1.md, sprints/10260429-cw-df525426/02-review-r2.md, sprints/10260429-cw-df525426/02-review.md, sprints/10260429-cw-df525426/02-spec.md
阶段分工与 C01-C12 边界：成立
```
