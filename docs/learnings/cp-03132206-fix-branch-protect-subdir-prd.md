# Learning - branch-protect.sh monorepo 子目录 PRD 保护 (v25)

**Branch**: cp-03132206-fix-branch-protect-subdir-prd
**PR**: 待填写

### 根本原因

`find_prd_dod_dir()` 向上遍历寻找 PRD/DoD 时，while 循环只遍历到 `project_root` 前一层（`current_dir != project_root` 条件）。在 monorepo 中，当文件在 `packages/workflows/scripts/` 下时，遍历路径为：`scripts → workflows → packages → （退出循环，返回 project_root）`。

如果 `project_root` 只有旧任务残留的全局 `.prd.md`（而非本次任务的 `.prd-{branch}.md`），函数直接返回 `project_root`，随后的内容检查错误通过了旧 PRD 内容，导致 hook 放行了错误状态下的写操作。

### 修复方案

在 `find_prd_dod_dir()` 的 while 循环体内追踪是否经过了 `packages/` 目录层（通过检查 `basename "$current_dir" == "packages"`）。循环退出后，若 `passed_through_packages=true` 且根目录无 `.prd-{branch}.md`，返回特殊标记 `__SUBDIR_NO_PERBRANCH_PRD__`，调用方 exit 2 并输出明确错误信息。

### 关键技术教训

1. **macOS symlink 陷阱（测试中）**：`mktemp` / Node.js `tmpdir()` 返回 `/var/folders/...`，但 `git rev-parse --show-toplevel` 返回 `/private/var/folders/...`（resolved）。bash `-f` 检查对两者都有效，但字符串比较会失败。解决：用 `basename` 检测目录名而非路径前缀匹配，完全绕开路径规范化问题。

2. **PRD 内容有效性检查**：hook 要求 PRD 至少 3 行且含关键字段（`功能描述|成功标准|需求来源|描述|标准`），测试中的 PRD 内容必须满足此条件，否则会在内容检查处 exit 2，而非 v25 逻辑处。

3. **`stat -c %a` 是 Linux 专有语法**：macOS 的 `stat` 不支持 `-c` 参数。测试中改用 `test -x` 检查执行权限，跨平台兼容。

4. **git worktree add 不能预先创建目标目录**：`git worktree add <path>` 要求目标路径不存在，需用时间戳生成唯一名称（`join(tmpdir(), "name-" + Date.now())`）而非 `mkdtempSync()`。

5. **v25 保护逻辑位置**：while 循环退出后才做 `passed_through_packages` 检查，而不是在循环内。这是因为循环终止条件是 `current_dir == project_root`，在 project_root 层的检查在循环后进行，保证了逻辑的清晰分离。

### 下次预防

- [ ] 在 monorepo 的 `packages/` 子目录下开发时，PRD/DoD 必须放在 worktree 根目录且使用 per-branch 格式（`.prd-{branch}.md`）
- [ ] 测试用 PRD 内容需 >= 3 行且包含"成功标准"等关键字段
- [ ] macOS 环境下测试涉及 git rev-parse 路径对比时，优先用 basename/目录名检测，避免路径字符串比较
