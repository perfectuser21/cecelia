## Brain {VERSION} — 修 host-disk-sampler 的 DEPLOY_ROOT 自推断

- `git -C <repo>/scripts rev-parse --git-common-dir` 返回的是**相对 `-C` 目录**的路径（实测 `../.git`）。旧实现只处理了返回值恰好等于 `.git` 的情况，其余走 `dirname` + `cd`，而 `cd` 的基准是「调用者的当前工作目录」而非 `SCRIPT_DIR`——同一个 bug 在三种环境算出三个不同的错答案：本机交互少一层（`…/perfect21`）、SSH 非交互少两层（`/Users`，直接 `mkdir: Permission denied`）、容器内与 `capacity-gate` 读取路径不一致。
- 后果：样本落错地方 → `capacity-gate` 报 `sample_missing` → **预览环境永久 503**（自 09-09 起 842 次历史记录归零）。
- 修法：一律在 `SCRIPT_DIR` 下解析，让相对路径有正确基准；无 git 信息时回退 `SCRIPT_DIR/..` 而非硬编码某台机器的绝对路径。
- 回归测试补 3 条**不传 `CECELIA_DEPLOY_ROOT`** 的用例——既有用例全部显式传它，把推断逻辑整个绕过去了，这正是 bug 能长期存活的原因。
