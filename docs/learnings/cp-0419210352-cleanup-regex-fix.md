# cleanup-regex-fix（2026-04-19）

### 根本原因

`.github/workflows/cleanup-merged-artifacts.yml` 第 28 行的 grep 正则写的是旧命名约定 `^\.(prd|task)-`（带前导点、小写），但 /dev 流程产物命名已改为 `DoD.cp-*.md / PRD.cp-*.md / TASK_CARD.cp-*.md`（大写、无前导点、带 `.cp-` 前缀）。

命名改了，workflow 的正则没同步改。后果：

- workflow 每次 push 到 main 都跑、每次都走 "✅ 无残留文件" 分支、每次都 exit 0
- 表面绿（workflow 成功），实际 30 天未清理
- 根目录积累 36 个 `DoD.cp-*.md / PRD.cp-*.md / TASK_CARD.cp-*.md` 遗留文件

这是典型的"虚假绿"：机器检查通过，但检查目标本身是错的。

### 下次预防

- [ ] 变更文件命名约定（前缀/后缀/大小写）时，必须全仓 grep 搜索旧命名的所有引用，特别是 `.github/workflows/` 下任何 `grep/find/ls/awk/sed` 命令
- [ ] workflow 里的文件名模式匹配必须配对单元测试（本 PR 的 `packages/engine/tests/workflows/cleanup-artifacts-regex.test.ts` 作为模板：用 JS RegExp 从 yml 里提 grep -E 的正则字面量，对新/旧两种命名都验证）
- [ ] cleanup 类 workflow 输出 "无残留，跳过" 时，至少每月抽查一次根目录实际状态，不要只看 workflow 绿就假设健康
