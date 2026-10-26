---
task_id: 8b129e0c-96bc-492a-9d8d-ce04260caa6c
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner')
s=(r/'README.md').read_text().split('## QA 修复后的批准、合并和收账边界',1)[1]
t=(r/'lib/terminal.mjs').read_text()
m=(r/'lib/merge-gate.mjs').read_text()
checks={
 'terminal_completed_then_ready': all(x in s for x in ['finishSuccess','completed','cfg.automerge','gh pr ready <PR URL>','awaiting_qa','awaiting_manual_merge']) and t.index("status: 'completed'")<t.index('if (cfg.automerge)') and "['pr', 'ready', prUrl]" in t,
 'ready_not_approval_or_merge': '这次 ready 是非批准、非合并' in s and 'ready 自身没有 head CAS' in s,
 'gate_precise_qa_judge_required_source': all(x in s for x in ['精确 head','QA+独立 judge','required 检查全绿','可信 source','automerge=false','awaiting_human']),
 'gate_gets_and_cas': all(x in s for x in ['headRefOid,isDraft,state','ready 前后','OPEN','approved.head','--match-head-commit <approved.head>']) and "['pr', 'view', String(pr.number), '--json', 'headRefOid,isDraft,state']" in m and "'--match-head-commit', s.approved.head" in m,
}
for k,v in checks.items(): print(f'{k}={v}')
assert all(checks.values())
PY
```
```output
terminal_completed_then_ready=True
ready_not_approval_or_merge=True
gate_precise_qa_judge_required_source=True
gate_gets_and_cas=True
```

### E-2
对应: I-2
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text().split('## QA 修复后的批准、合并和收账边界',1)[1]
checks={
 'four_sha_roles': all(x in r for x in ['tested_head','approved.head','headRefOid','mergeCommit.oid','squash SHA']),
 'new_product_head_retest': '代码、产品改动或可信 main 同步产生新 HEAD 重新真实 QA、judge、CI、preview' in r,
 'record_only_rebind': all(x in r for x in ['本轮 05/06 准确记录提交','受保护来源链','产品与旧历史未改','不能声称模型测过记录 HEAD']),
 'fixed_base_full_source_proof': all(x in r for x in ['7724d4f246453d6a90b5c451e63d80fbb586628d','git diff-tree -r --raw --no-abbrev <parent> <child>','准确双父','实际 main ref','全 tree/source gate','不能改用浮动 main']),
}
for k,v in checks.items(): print(f'{k}={v}')
assert all(checks.values())
PY
```
```output
four_sha_roles=True
new_product_head_retest=True
record_only_rebind=True
fixed_base_full_source_proof=True
```

### E-3
对应: I-3
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r=Path('packages/brain/scripts/coding-workflow/runner')
s=(r/'README.md').read_text().split('## QA 修复后的批准、合并和收账边界',1)[1]
learning=(r/'lib/merge-learning.mjs').read_text()
closure=(r/'lib/pr-closure.mjs').read_text()
checks={
 'merged_receipt_independent_readback': all(x in s for x in ['实际 GitHub `MERGED`','syncTask GET','PATCH Brain','receipt_pending=false','PATCH 后独立 GET','Brain `status=completed`']),
 'learning_ids_full_hash': all(x in s for x in ['Learning ID','全文 SHA-256','独立 GET','learning_pending']) and 'found.get(id) === hashes[i]' in learning,
 'preview_next_tick_handoff': all(x in s for x in ['preview stop','stopped=true','下次实际 tick','handoff','历史 FAIL/HUMAN','错误恢复']) and 'JSON.parse(r.body)?.stopped === true' in closure,
}
for k,v in checks.items(): print(f'{k}={v}')
assert all(checks.values())
PY
```
```output
merged_receipt_independent_readback=True
learning_ids_full_hash=True
preview_next_tick_handoff=True
```

### E-4
对应: I-3
verdict: PASS
```command
python3 - <<'PY'
import subprocess
p='packages/brain/scripts/coding-workflow/runner/README.md'
b='7724d4f246453d6a90b5c451e63d80fbb586628d'
base=subprocess.check_output(['git','show',f'{b}:{p}'])
now=open(p,'rb').read()
mode_base=subprocess.check_output(['git','ls-tree',b,p],text=True).split()[0]
mode_now=subprocess.check_output(['git','ls-tree','HEAD',p],text=True).split()[0]
assert now.startswith(base)
assert now[len(base):].startswith(b'\n## QA \xe4\xbf\xae\xe5\xa4\x8d\xe5\x90\x8e\xe7\x9a\x84\xe6\x89\xb9\xe5\x87\x86\xe3\x80\x81\xe5\x90\x88\xe5\xb9\xb6\xe5\x92\x8c\xe6\x94\xb6\xe8\xb4\xa6\xe8\xbe\xb9\xe7\x95\x8c\n')
assert mode_base==mode_now=='100644'
print(f'PREFIX_OK base_bytes={len(base)} current_bytes={len(now)} mode={mode_now}')
PY
```
```output
PREFIX_OK base_bytes=27828 current_bytes=34492 mode=100644
```

### E-5
对应: I-4
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
s=Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text().split('## QA 修复后的批准、合并和收账边界',1)[1]
required=['真实 RED','真实 GREEN','完整 DAG','git diff-tree -r --raw --no-abbrev <parent> <child>','全 diff/index/worktree/untracked','README 原 bytes/mode 前缀','manifest 相对固定 base 零差异','当前 QA','可失败静态断言和内存破坏对抗','03/04 暂隐藏','judge-only historical_execution','完整捕获输出','整数退出码','draft FAIL/CANNOT','aggregated_output','C01-C12','不能用旧 A 信用替代本轮 B']
def valid(text): return all(term in text for term in required)
print('current_contract='+str(valid(s)))
for term in ['真实 RED','03/04 暂隐藏','judge-only historical_execution','C01-C12']:
 mutated=s.replace(term,'[已删除]',1)
 result=valid(mutated)
 print('mutation_'+term+'='+str(result))
 assert not result
assert valid(s)
PY
```
```output
current_contract=True
mutation_真实 RED=False
mutation_03/04 暂隐藏=False
mutation_judge-only historical_execution=False
mutation_C01-C12=False
```

### E-6
对应: I-4
verdict: PASS
```command
git merge-base --is-ancestor 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD && git rev-list --ancestry-path --parents 7724d4f246453d6a90b5c451e63d80fbb586628d..HEAD && git diff --name-status 7724d4f246453d6a90b5c451e63d80fbb586628d HEAD && git diff --cached --name-status && git diff --name-status && git status --short --untracked-files=all
```
```output
3cc668ff4b8c270907894fc245e419ac0280e2bf 7724d4f246453d6a90b5c451e63d80fbb586628d
M	packages/brain/scripts/coding-workflow/runner/README.md
?? sprints/10261236-cw-8b129e0c/01-intent.md
?? sprints/10261236-cw-8b129e0c/01-invariants.md
?? sprints/10261236-cw-8b129e0c/02-response-r1.md
?? sprints/10261236-cw-8b129e0c/02-review-r1.md
?? sprints/10261236-cw-8b129e0c/02-review-r2.md
?? sprints/10261236-cw-8b129e0c/02-review.md
?? sprints/10261236-cw-8b129e0c/02-spec.md
```

### E-7
对应: I-4
verdict: PASS
```command
git rev-list --ancestry-path --reverse --parents 7724d4f246453d6a90b5c451e63d80fbb586628d..HEAD | while read child parents; do for parent in $parents; do git diff-tree -r --raw --no-abbrev "$parent" "$child"; done; done
```
```output
:100644 100644 2916a62eec87de33983b0e6bfada686af213651b 4dd5e85ead76a045bb8a641db95f0be8c66b5020 M	packages/brain/scripts/coding-workflow/runner/README.md
```
