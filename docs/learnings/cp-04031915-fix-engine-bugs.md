# Learning: Engine 深度 Bug 修复

## 分支
`cp-04031915-fix-engine-bugs`

## 修复内容

### Bug 1: devloop-check.sh — PROJECT_ROOT 未定义
- **根本原因**: `devloop_check()` 函数中使用了 `${PROJECT_ROOT:-}` 但从未在函数内定义该变量，导致 cleanup.sh 路径变为 `/packages/engine/...`（缺少根路径前缀），第一个候选路径始终找不到
- **修复**: 在 `devloop_check()` 开头添加 `local PROJECT_ROOT; PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)`

### Bug 2: hook-utils.sh — 占位符误判
- **根本原因**: `text_contains_token()` 的占位符白名单只覆盖 `YOUR_KEY/YOUR_SECRET/YOUR_TOKEN` 结尾格式，未覆盖 `PLACEHOLDER`、`CHANGE_ME`、`INSERT_HERE` 等常见占位符关键词，导致 `sk-proj-PLACEHOLDER_KEY` 被误判为真实凭据
- **修复**: 在正则中添加 `PLACEHOLDER|YOUR_API|YOUR_TOKEN|YOUR_KEY|YOUR_SECRET|CHANGE_ME|INSERT_HERE`，并加 `-i` 标志（大小写不敏感）

### Bug 3: worktree-manage.sh — cleanup 命令失效
- **根本原因**: `cmd_cleanup()` 委托给外部 `worktree-gc.sh` 脚本，但该脚本从未被创建，导致所有 `worktree-manage.sh cleanup` 调用直接 `exit 1`
- **修复**: 内联实现 `cmd_cleanup()` — 用 `gh pr list --state merged` 检测已合并分支，安全删除对应 worktree

## 下次预防

- [ ] 函数内使用环境变量时，检查是否在函数作用域内定义（尤其是跨文件 source 的场景）
- [ ] 凭据占位符检测规则变更时，同步更新单元测试覆盖新格式
- [ ] `cmd_X()` 委托到外部脚本前，确认脚本实际存在；如果是 TODO，在函数内明确注释"待实现"而不是 exit 1
