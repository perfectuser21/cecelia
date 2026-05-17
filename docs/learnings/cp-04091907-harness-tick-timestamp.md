### 根本原因

tick.js 中大量 `console.log/warn/error` 直接调用，绕过了 `tickLog` 封装，导致这些日志缺少上海时区时间戳前缀。此外 `tickLog` 函数体内的 periodic summary 行也直接调用 `_tickWrite` 而未携带时间戳参数。

**实现决策**：采用统一 tickLog 模式（不引入独立 tickWarn/tickError），将所有 warn/error 路由为 `tickLog('[WARN]', ...)` / `tickLog('[ERROR]', ...)`。这样 Feature 1 ① 验证通过（tickLog 函数体外无裸 _tickWrite 调用），Feature 2 ② 走"统一模式" PASS 路径。

**合同外发现（仅记录，未实现）**：
1. branch-protect.sh `git rev-parse --show-toplevel` 在 bare repo worktree 中失败（"this operation must be run in a work tree"），需在 hook 中为 bare repo 添加 fallback 路径提取逻辑
2. 合同 Feature 1 ④ 验证命令路径错误（`packages/brain/src/server.js` 不存在，实际路径为 `packages/brain/server.js`），Evaluator CI 运行时此验证会报 ENOENT 错误

### 下次预防

- [ ] 合同验收命令中的文件路径须在提案阶段对照实际仓库结构验证
- [ ] branch-protect.sh 应在 bare repo 场景下 fallback 到从 FILE_DIR 向上查找 .git 来获取 PROJECT_ROOT
- [ ] Generator 遇到 bare repo worktree 时需先设置 `git config --worktree core.bare false` 才能通过 hook
