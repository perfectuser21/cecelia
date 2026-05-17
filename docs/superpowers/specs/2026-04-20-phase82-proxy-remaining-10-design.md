# Phase 8.2 设计：autonomous-research-proxy 剩余 10 点深度化

**日期**：2026-04-20
**分支**：`cp-0420151819-cp-04201518-phase82-proxy-remaining-10`
**Engine 版本**：v18.2.0 → v18.3.0（minor — proxy 行为扩展）

---

## 背景

Phase 8.1 深度化了 Superpowers 32 个交互点中的 13 个关键路径点（brainstorming 6 + SDD 3 + RCR 4）。剩余 10 点分布在 writing-plans / executing-plans / TDD / finishing / systematic-debugging / requesting-code-review / dispatching-parallel-agents / using-git-worktrees 几个 skill。Phase 8.2 补齐这 10 点，使 /dev 接力链全链 0 人为 gate。

---

## 范围

### 做（10 点）

| 点 | 所在 skill | 处理方式 |
|---|---|---|
| WP-1 | writing-plans | Research Subagent（prompt A.WP-1） |
| EP-1 | executing-plans | Research Subagent（prompt A.EP-1）+ 产出 `.concerns-<branch>.md` |
| TDD-1 | test-driven-development | 硬规则（按 commit type） |
| FAD-1 | finishing-a-development-branch | 硬规则（Option 2） |
| SD-1 | systematic-debugging | 硬阈值（ci_fix_count>=3） |
| RCR-REQ-1 | requesting-code-review | 硬规则（按严重度分档） |
| DPA-1 | dispatching-parallel-agents | Research Subagent（prompt A.DPA-1） |
| DPA-2 | dispatching-parallel-agents | Research Subagent（prompt A.DPA-2） |
| UGW-1 | using-git-worktrees | 硬规则（固定路径） |
| UGW-2 | using-git-worktrees | 硬 self-heal 流程 |

FAD-2（discard confirm）按 Phase 8.1 结论"理论人为但流程永不触发"，保持现状不做深度 prompt。

### 不做

- Phase 8.1 已做的 13 点
- 不改 hook / CI workflow / Superpowers 原生 SKILL.md
- 不改 Brain 代码（Phase 8.3 的基础设施已落）

---

## 方案

扩展单一 proxy.md 文件，在 Phase 8.1 13 点规则 section 后追加 Phase 8.2 10 点规则 section，Appendix A 追加 4 个 prompt 模板。保持 Phase 8.1 的格式约定（Superpowers 原问 verbatim + 数据源 + 规则 + Prompt 引用）。

---

## 版本同步（7 处）

| 文件 | 改动 |
|------|------|
| `packages/engine/VERSION` | 18.2.0 → 18.3.0 |
| `packages/engine/package.json` | version 18.3.0 |
| `packages/engine/package-lock.json` | 两处 18.3.0 |
| `packages/engine/.hook-core-version` | 18.3.0 |
| `packages/engine/hooks/VERSION` | 18.3.0 |
| `packages/engine/regression-contract.yaml` | version 18.3.0 |
| `packages/engine/skills/dev/SKILL.md` | frontmatter version 18.3.0 |
| `packages/engine/feature-registry.yml` | 新 18.3.0 changelog 条目 |

---

## DoD

- [x] [ARTIFACT] `packages/engine/skills/dev/steps/autonomous-research-proxy.md` 含 10 个 Phase 8.2 深化锚点
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');['WP-1','EP-1','TDD-1','FAD-1','SD-1','RCR-REQ-1','DPA-1','DPA-2','UGW-1','UGW-2'].forEach(p=>{if(!c.includes(p))process.exit(1)})"`
- [x] [ARTIFACT] proxy.md Appendix A 含 4 个 Phase 8.2 prompt
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');['A.WP-1','A.EP-1','A.DPA-1','A.DPA-2'].forEach(p=>{if(!c.includes(p))process.exit(1)})"`
- [x] [ARTIFACT] proxy.md frontmatter version 升级到 3.1.0
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');if(!c.includes('version: 3.1.0'))process.exit(1)"`
- [x] [BEHAVIOR] 跑测试验证 10 点 anchor + 4 个 Appendix prompt 存在
  - Test: `tests/proxy/phase82-10-points.test.ts`
- [x] [ARTIFACT] Engine 版本同步到 18.3.0（7 处）
  - Test: `manual:bash -c "for f in packages/engine/VERSION packages/engine/.hook-core-version packages/engine/hooks/VERSION; do grep -q '18\.3\.0' \$f || exit 1; done"`
- [x] [ARTIFACT] `feature-registry.yml` 新 18.3.0 条目
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('18.3.0'))process.exit(1)"`

---

## Review（autonomous，brainstorming）

**依据**：
- 用户的话：Phase 8.2 任务单 10 点分类 + "硬默认 subagent-driven (Tier 1 既定)" / "硬默认 Option 2 (Tier 1 既定)" / "ci_fix_count>=3 硬触发" / "worktree 固定路径（硬规则）"
- 代码：现有 proxy.md v3.0.0 + Tier 1 表已列 WP-1 / FAD-1 默认值 + memories/worktree-patterns.md
- OKR：Cecelia Engine KR — /dev 工作流自主化闭环（0 人为 gate）

**判断**：APPROVE

**confidence**：HIGH

**质量分**：9/10

**风险**：
- R1：EP-1 的 `.concerns-<branch>.md` 格式与 PR body 集成依赖 finishing-a-development-branch 的行为，若 Superpowers 升级改了 PR body 模板则需同步
- R2：SD-1 的 `ci_fix_count` 从 `.dev-mode.<branch>` 读，若 dev-mode 迁移到 Brain DB 要同步改

**下一步**：进入 writing-plans → SDD → finishing → engine-ship
