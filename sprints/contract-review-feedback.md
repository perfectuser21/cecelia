# Contract Review Feedback (Round 2)

**任务 ID**: 39fd84e8-7fd9-4ebc-89f6-8fe9c2ce684e  
**审查时间**: 2026-04-09  
**结论**: REVISION（3 个 CRITICAL 命令级问题）

---

## 必须修改项

### 1. [命令根本无效] Feature 2 — devloop-check.sh 直接调用参数被完全忽略

**问题**: 合同所有 4 条 devloop-check 测试使用：
```bash
bash packages/engine/lib/devloop-check.sh "test-branch" "$TMPDIR/.dev-mode"
```
但实际脚本入口是 `devloop_check_main "$@"`，该函数**扫描 git worktree 中的 `.dev-mode.*` 文件**，完全不使用 `$1`/`$2` 命令行参数（见 `devloop-check.sh:316-347`）。  
效果：所有测试实际上在测"当前 worktree 无 .dev-mode 文件时脚本行为"，而非合同声称的场景。

**影响**:
- "Harness 正常完成 → exit 0"：因 worktree 无 .dev-mode 文件，输出 `NO_ACTIVE_SESSION`，exit 0（错误原因通过）
- "cleanup_done 残留 → exit 2"：exit 0（FAIL，期望 exit 2）
- "标准模式 cleanup_done → exit 0"：exit 0（错误原因通过）
- "Harness 无 PR URL → exit 2"：exit 0（FAIL，期望 exit 2）

**建议**: 改为通过 `source` + 直接调用 `devloop_check` 函数测试：
```bash
# 正确方式: source 后调用内部函数
source packages/engine/lib/devloop-check.sh
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/.dev-mode" << 'EOF'
dev
task_id: test-001
harness_mode: true
step_2_code: done
EOF
# 用 mock gh 或临时创建真实 PR 的方式测试
result=$(devloop_check "test-branch" "$TMPDIR/.dev-mode")
EXIT_CODE=$?
```

---

### 2. [命令根本无效] Feature 2 — stop-dev.sh 不支持 DEV_LOCK_PATH / DEV_MODE_PATH 环境变量

**问题**: 合同测试命令：
```bash
DEV_LOCK_PATH="$DEVLOCK" DEV_MODE_PATH="$DEVMODE" \
  bash packages/engine/hooks/stop-dev.sh 2>&1
```
但脚本（stop-dev.sh:59-74）通过 `_collect_search_dirs()` 扫描真实目录查找 `.dev-lock.*` 文件，**不读取 DEV_LOCK_PATH / DEV_MODE_PATH 环境变量**。这两个变量在脚本中未定义、未引用。

**影响**: stop-dev.sh 的全部 2 条验证命令（单次 + 3次幂等）均无效——脚本会扫描真实 worktree，找不到测试临时文件，直接 `exit 0`，导致全部误判为 PASS。

**建议**: 使用脚本实际支持的隔离方式，例如将测试 .dev-lock.* 和 .dev-mode.* 文件放置到 worktree 根目录，或重构脚本以支持 --dev-lock / --dev-mode 参数，或直接在 E2E 测试（Feature 3）中覆盖 stop-dev.sh 场景。

---

### 3. [命令有误] Feature 2 — .dev-mode 测试文件缺少首行 `dev`，触发 stop-dev.sh block

**问题**: stop-dev.sh 第 113-115 行强制校验 `.dev-mode` 首行必须是字面字符串 `dev`：
```bash
DEV_MODE_FIRST=$(head -1 "$DEV_MODE_FILE")
if [[ "$DEV_MODE_FIRST" != "dev" ]]; then
    # → block，输出错误 JSON
```
合同所有测试的 .dev-mode 文件首行是 `task_id: test-task-001`，会触发 "dev-mode 首行损坏" block，即使文件格式其他部分正确也无法通过。

**影响**: 即使问题 1/2 修复后，stop-dev.sh 测试仍会因首行校验失败而 block（非 exit 0）。

**建议**: 所有 .dev-mode 测试文件首行改为 `dev`：
```
dev
task_id: test-task-001
harness_mode: true
...
```

---

## 不需要修改（已验证正确）

- **Feature 1** 全部 5 条验证命令：逻辑正确，`node -e` 读文件检查关键字符串，可直接执行
- **Feature 3** 测试用例数阈值：基线 22 已核实，`>= 28` 阈值合理
- **Feature 3** 网络调用检测命令：正则 `/api\.github|localhost:5221(?!.*mock)/` 覆盖场景合理
- **Feature 2** 标准模式 + cleanup_done 路径的**逻辑描述**正确（代码行为与合同描述一致），只是测试命令无效

---

## 修复优先级

| # | 类型 | Feature | 严重性 |
|---|------|---------|--------|
| 1 | 命令根本无效 | Feature 2 devloop-check 调用方式 | CRITICAL |
| 2 | 命令根本无效 | Feature 2 stop-dev.sh 环境变量注入 | CRITICAL |
| 3 | 命令有误 | Feature 2 .dev-mode 首行格式 | CRITICAL |

Feature 2 的 6 条验证命令需要全部重写，Feature 1 和 Feature 3 可以保持不变。
