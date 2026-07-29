# 小改动 PrepPRD：AGENTS.md 补齐硬规则摘要 + Codex/Claude/Grok 规则一致性 drift-guard

## 改什么
1. 在 `.claude/CLAUDE.md` 里新增一个「硬规则摘要」section，用 `<!-- HARD_RULES:BEGIN -->` / `<!-- HARD_RULES:END -->` 标记边界，从现有 CLAUDE.md + 用户全局规则里蒸馏出几十条真正的约束类规则（语言/分支/危险操作确认/DevGate/commit规范/PR规则），不收知识类内容。
2. 在根目录 `AGENTS.md` 里新增同名 section，内容与 CLAUDE.md 里的版本逐字一致（同一对 marker）。
3. 新增 `scripts/check-agents-rules-sync.sh`：提取两个文件里 marker 之间的内容并 diff，不一致则非零退出 + 可读报错。
4. 接入 CI：在 `.github/workflows/ci.yml` 里新增一个不依赖 `needs.changes` 门控、对所有 PR 都跑的 job（仿照现有 `branch-naming` job 的写法）。

## 为什么改
07-29 实测：`codex exec` 纯任务提示词下只会原生读取 AGENTS.md，完全不读 CLAUDE.md；而本仓库根目录 AGENTS.md 自 2026-03-16 起未更新，是纯架构地图，不含任何行为约束。这意味着 Codex 执行的任何任务实际上读不到任何行为规则。Grok 和 Claude Code 经实测都会原生读到 CLAUDE.md，不受影响。

## 关联上下文
- Journey：`e6f803f2` 工厂 · F1 开发闭环
- 相关 Brain task：`cac58328-2608-4941-98f8-c2d0991242a3`
- 不涉及历史 decisions 匹配（`decisions/match` 查询为空）

## 影响范围
纯文档 + CI 脚本改动，不改 `packages/brain`/`packages/engine` 任何运行时代码，不碰当前被 P0 `4a530430`（Kernel Fleet bootstrap recovery）占用的 `orchestrator/` 目录。

## 验收标准
- [ ] `.claude/CLAUDE.md` 与 `AGENTS.md` 均含 `<!-- HARD_RULES:BEGIN -->`...`<!-- HARD_RULES:END -->` 区块，内容逐字一致
- [ ] `scripts/check-agents-rules-sync.sh` 存在，同步状态下退出码 0
- [ ] 回归测试：故意让两处内容不一致，脚本非零退出并给出清晰报错（覆盖 bug-fix 类哨兵要求）
- [ ] CI 新增 job 跑通该脚本，接入 `ci.yml`
- [ ] CI 全绿
