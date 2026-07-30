# 设计：AGENTS.md 硬规则摘要 + Codex/Grok 规则一致性 drift-guard

## 背景

07-29 实测（非推测）：用本机已认证的 `codex`（team1 账号）和 `grok` CLI，在隔离测试目录里跑了两组探针：

- 明确问"列出你能看到的规则文件" → codex 和 grok 都会读到 AGENTS.md 和 CLAUDE.md
- 纯任务型提示词（不提规则）→ **grok 主动读了 AGENTS.md 和 CLAUDE.md；codex 只读了 AGENTS.md，完全没读 CLAUDE.md**

本仓库根目录 `AGENTS.md`（101 行，最后 git 改动 2026-03-16 #989）是纯架构地图，不含 `.claude/CLAUDE.md` 里的任何行为约束（语言规则/危险操作确认/分支保护/DevGate/decisions 表规则等）。结论：Codex 执行任务时实际读到的规则是四个月前的过时架构图，一条行为约束都没有；Grok 和 Claude Code 不受影响。

## 方案

**约束和知识分家**：只把"违反=事故"的约束类规则蒸馏进摘要，不塞知识类内容（RPA 踩坑、设备清单等已在别处，本次不动）。

1. `.claude/CLAUDE.md` 新增 section「硬规则摘要」，`<!-- HARD_RULES:BEGIN -->` / `<!-- HARD_RULES:END -->` 包裹，约 20-30 条纯约束。
2. 根目录 `AGENTS.md` 追加同名 section + 同一对 marker，内容与 CLAUDE.md 逐字一致，附加在现有 101 行之后（不改动现有内容）。
3. 新增 `scripts/check-agents-rules-sync.sh`：提取两文件 marker 间内容 diff，一致 exit 0，不一致打印 diff + 提示 exit 1（参考 `scripts/check-version-sync.sh` 风格）。
4. TDD：先写会失败的测试（覆盖"制造漂移→非零退出"和"同步→零退出"两种场景），再实现脚本让测试变绿。
5. `.github/workflows/ci.yml` 新增不依赖 `needs.changes` 门控、所有 PR 必跑的新 job（参照 `branch-naming` job 写法），并把该 job 名补进 all-green 汇总 job 的 `needs` 列表，确保真正门禁合并。

## 边界

- 不改动 `packages/brain` 任何运行时代码，不碰 `orchestrator/`（P0 `4a530430` Kernel Fleet bootstrap recovery 占用中）
- 不新建第三份规则文件——SSOT 就是 `.claude/CLAUDE.md` 里的摘要 section，AGENTS.md 是同步副本
- 不做语义摘要/AI 生成式同步——drift-guard 就是纯文本 diff，简单可靠

## 测试策略

- Unit：`check-agents-rules-sync.sh` 的漂移检测逻辑（构造临时文件对比）
- Regression：故意让两个 marker 区块内容不同，断言脚本非零退出且报错信息可读
- CI 集成：新 job 实际跑起来，接入 all-green 汇总

## 风险

- 硬规则摘要蒸馏質量依赖本次判断，后续如需增补走正常 PR 流程即可，drift-guard 只保证"两处一致"，不保证"内容本身完备"
