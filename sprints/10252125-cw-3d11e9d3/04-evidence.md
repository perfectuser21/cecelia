---
task_id: 3d11e9d3-3660-4412-afba-722c7a1936c3
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r = Path("packages/brain/scripts/coding-workflow/runner")
doc = (r / "README.md").read_text()
checkout = (r / "lib/pr-checkout.mjs").read_text()
branch = (r / "lib/pr-branch.mjs").read_text()
worktree = (r / "lib/worktree.mjs").read_text()
checks = {
 "文末小节标题": "## QA准备失败、保留现场与升级如何判读" in doc,
 "先抓取PR分支": "['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]" in branch and "先从 `origin` 抓取 PR 分支" in doc,
 "分支占用判定": "listed.stdout.split('\\0').includes(`branch refs/heads/${branch}`)" in checkout and "同名本地分支未被占用" in doc,
 "实际SHA及原origin": "['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`]" in checkout and "['remote', 'get-url', '--push', 'origin']" in checkout and "实际抓取的 40 位 SHA" in doc,
 "独立clone与真实分支": "['clone', '--shared', '--no-checkout', '--no-hardlinks'" in checkout and "['checkout', '-B', branch, head.stdout.trim()]" in checkout and "独立 refs/index" in doc,
 "marker归属清理": "record.repo !== fs.realpathSync(cfg.repo)" in checkout and "record.worktree !== fs.realpathSync(worktree)" in checkout and "record.branch !== branch" in checkout and "fs.rmSync(worktree, { recursive: true })" in checkout and "未知 marker、路径或归属返回 false" in doc,
 "普通worktree清理": "if (checkout !== null) return checkout" in worktree and "['worktree', 'remove', '--force', worktree]" in worktree and "if (removed.code === 0 && branch)" in worktree and "仅在该命令成功后处理其本地分支" in doc,
 "原现场保留": "不覆盖、解锁或删除原失败工作树" in checkout and "不能以删除原目录、原分支或改状态代替归属核验" in doc,
}
for name, ok in checks.items(): print(f"{name}: {'PASS' if ok else 'FAIL'}")
print("I-1: " + ("PASS" if all(checks.values()) else "FAIL"))
PY
```
```output
文末小节标题: PASS
先抓取PR分支: PASS
分支占用判定: PASS
实际SHA及原origin: PASS
独立clone与真实分支: PASS
marker归属清理: PASS
普通worktree清理: PASS
原现场保留: PASS
I-1: PASS
```

### E-2
对应: I-2
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
r = Path("packages/brain/scripts/coding-workflow/runner")
doc = (r / "README.md").read_text()
qa = (r / "lib/qa-gate.mjs").read_text()
cfg = (r / "lib/config.mjs").read_text()
checks = {
 "示例明确非现场": "**示例数据、不是现场运行结果**" in doc and '{"bad":1,"rounds":[]}' in doc,
 "bad与已提交轮分离": "s.bad = (s.bad ?? 0) + 1" in qa and "s.rounds.push(entry)" in qa and "记录提交成功才算这一轮" in qa and "尚无已完成 QA 轮" in doc,
 "QA语义与独立裁判分离": "const verdict = qa.verdict" in qa and "entry.judge =" in qa and "Commander HUMAN 必须另核实际 Commander 终态" in doc,
 "try内准备异常阈值": "try {\n    await preparePrWorktree" in qa and "if (s.bad >= cfg.qaMaxBadStreak) return await escalate(ctx, pr, s, null, { type: 'qa_evaluator_broken'" in qa and "受保护 try/catch 内" in doc,
 "evaluate异常阈值": "if (result?.failure_class === 'fatal' || result?.failure_class === 'needs_human' || s.bad >= cfg.qaMaxBadStreak)" in qa and "致命或需人工的失败类别可提前升级" in doc,
 "配置阈值": "qaMaxBadStreak: positiveInt(env.CODING_WF_QA_MAX_BAD_STREAK) ?? 3" in cfg and "实际阈值来自 `CODING_WF_QA_MAX_BAD_STREAK`" in doc,
 "升级不推断终态": "escalated` 是交 coding commander 的升级记录" in doc and "不表示产品失败、通过或 Commander HUMAN" in doc and "不能承诺任意 OS 异常" in doc,
}
for name, ok in checks.items(): print(f"{name}: {'PASS' if ok else 'FAIL'}")
print("I-2: " + ("PASS" if all(checks.values()) else "FAIL"))
PY
```
```output
示例明确非现场: PASS
bad与已提交轮分离: PASS
QA语义与独立裁判分离: PASS
try内准备异常阈值: PASS
evaluate异常阈值: PASS
配置阈值: PASS
升级不推断终态: PASS
I-2: PASS
```

### E-3
对应: I-3
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
import subprocess
r = Path("packages/brain/scripts/coding-workflow/runner")
doc = (r / "README.md").read_bytes()
base = subprocess.run(["git", "show", "0bbee7b45e4ce79ed2752785fbdb0fd805357879:packages/brain/scripts/coding-workflow/runner/README.md"], check=True, capture_output=True).stdout
qa = (r / "lib/qa-gate.mjs").read_text()
text = doc.decode()
added = doc[len(base):] if doc.startswith(base) else b""
checks = {
 "基线README全部原字节及A11/A12原文保留": doc.startswith(base),
 "仅在文末追加小节": added.startswith(b"\n## QA") and doc.count("## QA准备失败、保留现场与升级如何判读".encode()) == 1,
 "原README模式保留": all(subprocess.run(["git", "ls-tree", ref, "packages/brain/scripts/coding-workflow/runner/README.md"], capture_output=True, text=True, check=True).stdout.startswith("100644 ") for ref in ["HEAD", "0bbee7b45e4ce79ed2752785fbdb0fd805357879"]),
 "报告投递与任务终态分账": "const r = await ctx.brain.patch(taskId, { result });" in qa and "if (!r.ok) ctx.log(" in qa and "report 投递失败、本地 QA 状态、Brain task 状态和产品判定须分别读原始账" in text,
 "原始失败现场保留": all(x in text for x in ["原始错误、失败尝试、GAN FORCED 与历史失败均须保留", "后续正常恢复不能抹掉旧失败", "不能以删除原目录、原分支或改状态代替归属核验"]),
 "只读且无手动恢复指令": "以下只用于只读核账" in text and "不从本节推断应手动重试或设为 ready" in text and "不通过强删、手改状态或生产操作" in text,
}
for name, ok in checks.items(): print(f"{name}: {'PASS' if ok else 'FAIL'}")
print("I-3: " + ("PASS" if all(checks.values()) else "FAIL"))
PY
```
```output
基线README全部原字节及A11/A12原文保留: PASS
仅在文末追加小节: PASS
原README模式保留: PASS
报告投递与任务终态分账: PASS
原始失败现场保留: PASS
只读且无手动恢复指令: PASS
I-3: PASS
```

### E-4
对应: I-4
verdict: PASS
```command
python3 - <<'PY'
from pathlib import Path
import re
import subprocess
base = "0bbee7b45e4ce79ed2752785fbdb0fd805357879"
readme = "packages/brain/scripts/coding-workflow/runner/README.md"
manifest = ".implementation-source-relations.json"
def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout
commits = git("rev-list", "--parents", "--topo-order", f"{base}..HEAD").decode().splitlines()
head_paths = git("diff", "--name-only", base, "HEAD").decode().splitlines()
staged = git("diff", "--cached", "--name-only").decode().splitlines()
working = git("diff", "--name-only").decode().splitlines()
untracked = git("ls-files", "--others", "--exclude-standard", "-z").decode().strip("\0").split("\0")
allowed_record = re.compile(r"^sprints/10252125-cw-3d11e9d3/(01-intent|01-invariants|02-spec|02-review(?:-r[1-9][0-9]*)?|02-response-r[1-9][0-9]*|03-build|04-evidence)\.md$")
base_readme = git("show", f"{base}:{readme}")
base_manifest = git("show", f"{base}:{manifest}")
checks = {
 "基线是HEAD祖先": subprocess.run(["git", "merge-base", "--is-ancestor", base, "HEAD"]).returncode == 0,
 "完整DAG变更仅README": head_paths == [readme] and len(commits) == 1,
 "暂存区与工作区无改动": not staged and not working,
 "全仓未跟踪仅本任务流水线记录": all(allowed_record.fullmatch(p) for p in untracked),
 "README基线原字节保留": Path(readme).read_bytes().startswith(base_readme),
 "manifest相对基线未改": git("show", f"HEAD:{manifest}") == base_manifest and Path(manifest).read_bytes() == base_manifest,
}
print("提交DAG:", commits)
print("基线到HEAD路径:", head_paths)
print("暂存区:", staged)
print("工作区:", working)
print("全仓未跟踪:", untracked)
for name, ok in checks.items(): print(f"{name}: {'PASS' if ok else 'FAIL'}")
print("I-4: " + ("PASS" if all(checks.values()) else "FAIL"))
PY
```
```output
提交DAG: ['d1c172c1cdf8bca7851453739fb7b5deb526c641 0bbee7b45e4ce79ed2752785fbdb0fd805357879']
基线到HEAD路径: ['packages/brain/scripts/coding-workflow/runner/README.md']
暂存区: []
工作区: []
全仓未跟踪: ['sprints/10252125-cw-3d11e9d3/01-intent.md', 'sprints/10252125-cw-3d11e9d3/01-invariants.md', 'sprints/10252125-cw-3d11e9d3/02-response-r1.md', 'sprints/10252125-cw-3d11e9d3/02-review-r1.md', 'sprints/10252125-cw-3d11e9d3/02-review-r2.md', 'sprints/10252125-cw-3d11e9d3/02-review.md', 'sprints/10252125-cw-3d11e9d3/02-spec.md']
基线是HEAD祖先: PASS
完整DAG变更仅README: PASS
暂存区与工作区无改动: PASS
全仓未跟踪仅本任务流水线记录: PASS
README基线原字节保留: PASS
manifest相对基线未改: PASS
I-4: PASS
```
