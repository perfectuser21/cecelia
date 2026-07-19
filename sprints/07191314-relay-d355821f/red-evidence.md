# Red Evidence

Task: d355821f-4a37-4fa2-ad2f-99668bc91a3d

Command:

```bash
bash -lc 'set -o pipefail; bash sprints/07191314-relay-d355821f/tests/contract-red.test.sh 2>&1 | tee /tmp/red-evidence-d355821f.txt'
```

Result: exit 1.

Expected Red reason: `sprints/07191314-relay-d355821f/e2e-verify.sh` is missing.

Summary:

```text
TEST: contract files are rebound to current task
PASS: contract files are rebound to current task
TEST: e2e-verify.sh 校验当前 task API payload shape
FAIL: missing /Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-d355821f/sprints/07191314-relay-d355821f/e2e-verify.sh
TEST: e2e-verify.sh 校验当前 task DB claim oracle
FAIL: missing /Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-d355821f/sprints/07191314-relay-d355821f/e2e-verify.sh
TEST: e2e-verify.sh 对 initiative_runs 缺失输出 concern 且不当作成功证据
FAIL: missing /Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-d355821f/sprints/07191314-relay-d355821f/e2e-verify.sh
TEST: e2e-verify.sh 拒绝历史 task 作为当前证据
FAIL: missing /Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-d355821f/sprints/07191314-relay-d355821f/e2e-verify.sh
TEST: e2e-verify.sh 日志证据限于当前 sprint 且脱敏
FAIL: missing /Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-d355821f/sprints/07191314-relay-d355821f/e2e-verify.sh
TEST: e2e-verify.sh local_api 全链路基于当前 task API 和 DB claim oracle
FAIL: missing /Users/administrator/perfect21/cecelia/.claude/worktrees/harness-v2/task-d355821f/sprints/07191314-relay-d355821f/e2e-verify.sh
FAIL: 6 contract red assertions failed
```
