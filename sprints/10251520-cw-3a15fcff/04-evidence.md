---
task_id: 3a15fcff-3af4-49b4-a4c2-b0c7c743ef49
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
import subprocess
r = Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text()
s = Path('packages/brain/scripts/coding-workflow/runner/status.mjs').read_text()
checks = {
 'FAQ仅出现一次且标为示例': r.count('## 回执常见误读与核账示例') == 1 and '示例数据、不是现场运行结果' in r,
 'A11小节保留且先于FAQ': r.count('## 运行回执如何判读') == 1 and r.index('## 运行回执如何判读') < r.index('## 回执常见误读与核账示例'),
 '参数与mtime倒序吻合': all(x in r for x in ['--log-dir', '--json', 'mtime 倒序']) and "argv[i] === '--log-dir'" in s and "argv[i] === '--json'" in s and 'b.mtimeMs - a.mtimeMs' in s,
 '空结果未当健康': 'JSON 是 `[]`' in r and '不能把空列表当作健康证明' in r and 'return [];' in s,
}
for name, ok in checks.items(): print(f'{name}: {"PASS" if ok else "FAIL"}')
raise SystemExit(0 if all(checks.values()) else 1)
PY
```
```output
FAQ仅出现一次且标为示例: PASS
A11小节保留且先于FAQ: PASS
参数与mtime倒序吻合: PASS
空结果未当健康: PASS
```

### E-2
对应: I-1
verdict: PASS
```command
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir /tmp/cw-verify-3a15fcff-nonexistent --json
```
```output
[]
```

### E-3
对应: I-2
verdict: PASS
```command
node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; import {summarizeReceipt} from "./packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs"; import {formatStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const r=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/status.mjs","utf8"); const partial={status:"partial",activities:[{key:"intent",status:"completed"},{key:"review",status:"skipped"},{key:"build",status:"failed",reason_code:"activity_reason",attempts:[{reason_code:"old_reason"},{reason_code:"last_attempt_reason"}]}],reason_code:"receipt_reason"}; for(const status of ["partial","failed"]){const x=summarizeReceipt({...partial,status}); assert.equal(x.failed_activity,"build"); assert.equal(x.reason_code,"last_attempt_reason"); assert.ok(r.includes(`显示 \`${status}\``));} const done=summarizeReceipt({status:"completed",outputs:{}}); assert.equal(done.reason_code,"pr_url_missing"); assert.equal(done.pr_url,null); assert.ok(!formatStatus([{task_id:"x",mtime:"t",...done,ci_fix:null}]).includes("pr_url_missing")); assert.ok(s.includes("\u0027last_event\u0027 in receipt") && s.includes("status: \u0027running\u0027") && s.includes("status: \u0027unreadable\u0027")); assert.ok(r.includes("ci_fix.attempts") && r.includes("ci_fix.last_result") && r.includes("ci_fix:null") && r.includes("pr-sync-pending") && r.includes("不能把空列表当作健康证明")); console.log("partial/failed原因与completed缺PR摘要: PASS"); console.log("running/unreadable/ci_fix文档与源码字段: PASS");'
```
```output
partial/failed原因与completed缺PR摘要: PASS
running/unreadable/ci_fix文档与源码字段: PASS
```

### E-4
对应: I-3
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r = Path('packages/brain/scripts/coding-workflow/runner/README.md').read_text()
t = Path('packages/brain/scripts/coding-workflow/runner/lib/terminal.mjs').read_text()
d = Path('packages/brain/scripts/coding-workflow/runner/lib/deps.mjs').read_text()
n = Path('packages/brain/scripts/coding-workflow/new-task.mjs').read_text()
checks = {
 'terminal完成态与QA分支吻合': "phase: cfg.qaGate ? 'awaiting_qa' : 'awaiting_manual_merge'" in t and "{ status: 'completed', result: { runner } }" in t and all(x in r for x in ['awaiting_qa', 'awaiting_manual_merge', 'result.runner.phase=merged', 'result.merge.merged=true', 'qa_state']),
 '合并后独立核账说明完整': all(x in r for x in ['最终 head', 'Learning 确认需单独回读', '下一次实际 tick', '不要手工改批准、FAIL 记录']),
 'deps直接就绪及GitHub分支吻合': "if (!url || task.result?.merged === true)" in d and all(x in d for x in ["pr === 'MERGED'", "pr === 'CLOSED'", "state: 'waiting'"]) and all(x in r for x in ['无 PR URL', 'result.merged===true', '`MERGED` 就绪', '`CLOSED` 拒绝']),
 'dry-run与base_sha格式吻合': "if (dryRun)" in n and "!/^[a-f0-9]{40}$/.test(baseSha)" in n and '预检退出 0 也不是建单或运行成功' in r,
}
for name, ok in checks.items(): print(f'{name}: {"PASS" if ok else "FAIL"}')
raise SystemExit(0 if all(checks.values()) else 1)
PY
```
```output
terminal完成态与QA分支吻合: PASS
合并后独立核账说明完整: PASS
deps直接就绪及GitHub分支吻合: PASS
dry-run与base_sha格式吻合: PASS
```

### E-5
对应: I-4
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
import subprocess
base = '05f28a953a9fa184ed53619eba2127a203edab0e'
readme = 'packages/brain/scripts/coding-workflow/runner/README.md'
manifest = '.implementation-source-relations.json'
def git(*args): return subprocess.run(['git', *args], check=True, capture_output=True).stdout
changed = git('diff', '--name-only', base, 'HEAD').decode().splitlines()
staged = git('diff', '--cached', '--name-only').decode().splitlines()
working = git('diff', '--name-only').decode().splitlines()
untracked = sorted(x.decode() for x in git('ls-files', '--others', '--exclude-standard', '-z').split(b'\0') if x)
old = git('show', f'{base}:{readme}')
new = Path(readme).read_bytes()
mode_old = git('ls-tree', base, '--', readme).decode().split()[0]
mode_new = git('ls-tree', 'HEAD', '--', readme).decode().split()[0]
allowed = {f'sprints/10251520-cw-3a15fcff/{n}' for n in ['01-intent.md','01-invariants.md','02-spec.md','02-review.md','02-review-r1.md','02-review-r2.md','02-review-r3.md','02-response-r1.md','02-response-r2.md','03-build.md','04-evidence.md']}
checks = {
 '固定基线到HEAD仅README': changed == [readme],
 '暂存区和工作区无改动': not staged and not working,
 '全仓未跟踪仅本轮流水线记录': set(untracked) <= allowed,
 '基线README是当前文件字节前缀且模式相同': new.startswith(old) and len(new) > len(old) and mode_old == mode_new,
 'manifest相对固定基线未改': not git('diff', '--name-only', base, 'HEAD', '--', manifest),
}
print('HEAD:', git('rev-parse', 'HEAD').decode().strip())
print('基线到HEAD改动:', changed)
print('暂存区:', staged, '工作区:', working)
print('全仓未跟踪:', untracked)
for name, ok in checks.items(): print(f'{name}: {"PASS" if ok else "FAIL"}')
raise SystemExit(0 if all(checks.values()) else 1)
PY
```
```output
HEAD: b5e6e650b78735a564dde9f5c13f14cb66bdd985
基线到HEAD改动: ['packages/brain/scripts/coding-workflow/runner/README.md']
暂存区: [] 工作区: []
全仓未跟踪: ['sprints/10251520-cw-3a15fcff/01-intent.md', 'sprints/10251520-cw-3a15fcff/01-invariants.md', 'sprints/10251520-cw-3a15fcff/02-response-r1.md', 'sprints/10251520-cw-3a15fcff/02-response-r2.md', 'sprints/10251520-cw-3a15fcff/02-review-r1.md', 'sprints/10251520-cw-3a15fcff/02-review-r2.md', 'sprints/10251520-cw-3a15fcff/02-review-r3.md', 'sprints/10251520-cw-3a15fcff/02-review.md', 'sprints/10251520-cw-3a15fcff/02-spec.md']
固定基线到HEAD仅README: PASS
暂存区和工作区无改动: PASS
全仓未跟踪仅本轮流水线记录: PASS
基线README是当前文件字节前缀且模式相同: PASS
manifest相对固定基线未改: PASS
```
