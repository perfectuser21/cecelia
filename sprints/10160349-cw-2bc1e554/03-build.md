---
task_id: 2bc1e554-43fa-47f9-9ef4-8ab8b6c5baf3
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---

# 运行回执判读手册 build 记录

### B-1

- 对应规格：S-1。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，新增 `--log-dir`、`--json`、默认目录、mtime 倒序及空结果判读。
- 验证方式：仅用系统临时目录中的本地 JSON 样本运行真实 `status.mjs`，并用临时断言检查 README；不新增或修改仓库测试，符合原任务的文档范围。
- 实际命令：`node /tmp/cw-2bc1e554-verify.mjs`。编辑前输出 `S-1: RED`，原因是 README 缺少“运行回执如何判读”；编辑后和提交后均输出 `S-1: PASS`。断言包括新旧文件 mtime 顺序、文本及 JSON 顺序、不存在目录精确输出 `[]`。
- 实际命令：`tmp_dir=$(mktemp -d); node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$tmp_dir" --json; node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$tmp_dir"; rmdir "$tmp_dir"`。输出依次为 `[]` 和 `没有运行记录（<临时目录>）`，退出码 0。
- 提交 SHA：`ea964fc1a1c1b9bc2d57183bfa8b05d8148b3ec7`。

### B-2

- 对应规格：S-2。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，新增运行与三种终态、`unreadable`、非回执 JSON、`pr-sync-pending.json` 和 `ci_fix` 的判读说明。
- 验证方式：临时样本覆盖进度快照、三种终态、坏 JSON、QA/Commander/待办状态、极简非回执和关联 cifix；真实 CLI 输出由可失败断言核对，不提交测试文件。
- 实际命令：`node /tmp/cw-2bc1e554-verify.mjs`。编辑前输出 `S-2: RED 缺少 running`；编辑后和提交后输出 `S-2: PASS`。断言确认 `partial` 的 `failed_activity=build`、`reason_code=build_failed`，`failed` 的 `failed_activity=qa`、`reason_code=qa_failed`，四类异常/非回执样本为 `unreadable`，极简终态为 `completed`，`ci_fix` 为 `attempts=2`、`last_result=passed`，cifix 文件不出任务行。
- 提交 SHA：`ea964fc1a1c1b9bc2d57183bfa8b05d8148b3ec7`。

### B-3

- 对应规格：S-3。
- 改动文件：`packages/brain/scripts/coding-workflow/runner/README.md`，说明 `completed` 与最终合并不同，要求查看 JSON 的 `pr_url` 并只读核对 GitHub 最终 head、Brain 合并字段和 QA 终态。
- 验证方式：用无 PR URL 的本地 completed 样本运行真实 CLI，断言文本与 JSON 的不同字段，并检查 README 的最终判据；不访问 GitHub、Brain 或生产，不修改仓库测试。
- 实际命令：`node /tmp/cw-2bc1e554-verify.mjs`。编辑前输出 `S-3: RED 缺少 pr_url_missing`；编辑后和提交后输出 `S-3: PASS`。JSON 样本保留 `status=completed`、`reason_code=pr_url_missing`、`pr_url=null`，文本显示 completed 而不显示该 reason。
- 提交 SHA：`ea964fc1a1c1b9bc2d57183bfa8b05d8148b3ec7`。

### B-4

- 对应规格：S-4。
- 改动文件：仅 `packages/brain/scripts/coding-workflow/runner/README.md`。新小节追加在文末，基线 README 全文作为最终文件的逐字连续前缀；未修改 manifest。
- 验证方式：先从全仓枚举未跟踪文件，再仅识别本任务 sprint 原有流水线记录；以固定 base SHA 检查已提交、暂存、工作区与 manifest。只读核对，无仓库测试或越界产品文件。
- 实际命令：`node /tmp/cw-2bc1e554-verify.mjs`。编辑前输出 `S-4: RED`（缺少新小节），编辑后和提交后输出 `S-4: PASS`。
- 实际命令：`git diff --name-only 52a9476e014f540d418014e7062ca66a72f38709 HEAD`、`git diff --cached --name-only`、`git diff --name-only`、`git ls-files --others --exclude-standard`、`git diff 52a9476e014f540d418014e7062ca66a72f38709 HEAD -- .implementation-source-relations.json`。提交后第一条仅输出 README，第二、三、五条均无输出；全仓未跟踪共 7 项，均为本任务 sprint 的已有流水线记录。
- 实际命令：以下内联 Python 断言获取基线全文，联合上述四类 Git 枚举核对范围：

```bash
python3 - <<'PY'
import subprocess
from pathlib import Path
base='52a9476e014f540d418014e7062ca66a72f38709'
readme='packages/brain/scripts/coding-workflow/runner/README.md'
run=lambda *args: subprocess.check_output(['git',*args],text=True)
base_text=run('show',f'{base}:{readme}')
current=Path(readme).read_text()
assert current.startswith(base_text), '基线 README 非逐字连续前缀'
assert run('diff',base,'--','.implementation-source-relations.json') == '', 'manifest 差异'
changed=set()
for args in [('diff','--name-only',base,'HEAD'),('diff','--cached','--name-only'),('diff','--name-only')]:
    changed.update(run(*args).splitlines())
assert changed == {readme}, f'产品差异越界: {changed}'
untracked=run('ls-files','--others','--exclude-standard').splitlines()
other=[p for p in untracked if not p.startswith('sprints/10160349-cw-2bc1e554/')]
assert not other, f'仓库未跟踪越界: {other}'
print('S-4 PASS: 基线README逐字连续保留；manifest零差异；产品差异仅README；全仓未跟踪仅本任务sprint记录')
print('全仓未跟踪:', len(untracked), '项')
PY
```

  实际输出：`S-4 PASS: 基线README逐字连续保留；manifest零差异；产品差异仅README；全仓未跟踪仅本任务sprint记录` 和 `全仓未跟踪: 7 项`。
- 实际命令：`git diff --check`、`git diff --cached --check`，均退出 0 且无输出。提交后 `git status --short --branch` 仅显示当前分支及 `?? sprints/10160349-cw-2bc1e554/`，无本次遗留的已暂存或未暂存产品改动。
- 提交 SHA：`ea964fc1a1c1b9bc2d57183bfa8b05d8148b3ec7`。
