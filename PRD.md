# PRD: Engine Skillification — Phase 5（14.17.11 → 15.0.0）

## 背景

Phase 4（PR #2419）把 Engine 瘦身到"Superpowers 自动化适配层"，删除了 prompts/ 本地复刻，改走 runtime Skill tool 加载 `/superpowers:*`。但实测发现 **skill chain 根本不自驱动**：

- `/dev` 是唯一真 skill，其余 6 个 `.md`（Step 0/0.5/0.7/3/4 + research-proxy）只是 md 文档，靠 `Read` 加载
- 没有一个文件结尾有 Superpowers 式的 terminal imperative（"Now invoke `/<next-skill>` via Skill tool"），主 agent 读完文档就散了
- `steps/00-worktree-auto.md` 结尾指向已删除的 `Step 1 (Spec)`，**坏链**
- `Stage 3 (03-integrate.md)` 和 Superpowers `finishing-a-development-branch` **功能重叠**（都做 push+PR），是 Phase 4 该删未删的冗余

stream-json 实测（2026-04-19）：纯净无提示下触发 `/dev`，主 agent 调了 `Skill({"skill":"dev"})` 后只 `Read` 了前置 step 文档，**没有**自发 invoke `/superpowers:brainstorming`。证明问题不在 plugin 装没装（account1 已装），在 /dev 本身缺点火机制。

## 真实目的

让 /dev 真正按 Superpowers 的"每个 skill 自带 terminal imperative 接到下一个"范式跑通。Engine 4 个独有能力（worktree / enrich / decision / ship）升级为真 skill，/dev 本身退化成点火入口。

## 成功标准

1. **4 个新真 skill 存在且可激活**：`/engine-worktree`、`/engine-enrich`、`/engine-decision`、`/engine-ship` — 无头调用都能看到 `Base directory for this skill:` 前缀
2. **每个新 skill SKILL.md 结尾有 TERMINAL IMPERATIVE 块**：明确指令主 agent 下一步必须 Skill 调用链上下一个 skill
3. **无头纯净测试（无 Skill-tool 提示词）真接力跑通**：stream-json 轨迹里连续出现 `Skill({"skill":"dev"})` → `Skill({"skill":"engine-worktree"})` → `Skill({"skill":"engine-enrich"})` → `Skill({"skill":"engine-decision"})` → `Skill({"skill":"superpowers:brainstorming"})`
4. **Stage 3 冗余彻底删除**：`steps/03-integrate.md` 不存在；Superpowers `finishing-a-development-branch` 完成后由 autonomous-research-proxy 规则硬性接到 `/engine-ship`
5. **坏链修复**：原 `steps/00-worktree-auto.md` 结尾引用已删除的 "Step 1 (Spec)" — 整个文件 migrate 成 skill 后无此问题
6. **Engine 6 处版本同步到 15.0.0**（major bump，架构级）
7. **feature-registry changelog + Learning 文件**到位，engine-hygiene DevGate 通过

## 方案选择

| 方案 | Good | Bad | 选 |
|---|---|---|---|
| a. 本地 skill + `engine-` 前缀 | 不需建 plugin registry，和 /dev 一个体系，命名简单 | 命名空间靠约定不严格 | ✅ |
| b. 做成真 plugin `engine:<name>` | 和 Superpowers 对齐 | 要建 plugin marketplace，PR 工作量 2-3x | ❌ |
| c. 裸名 `/worktree` `/enrich` | 最短 | 容易和未来其他 skill 撞名 | ❌ |

## 涉及文件

**新建**（4 个 skill，每个一个目录）：
- `packages/engine/skills/engine-worktree/SKILL.md`
- `packages/engine/skills/engine-enrich/SKILL.md`
- `packages/engine/skills/engine-decision/SKILL.md`
- `packages/engine/skills/engine-ship/SKILL.md`

**修改**：
- `packages/engine/skills/dev/SKILL.md`（改成点火链）
- `packages/engine/skills/dev/steps/autonomous-research-proxy.md`（加 finishing → /engine-ship 硬规则）
- `packages/engine/VERSION` / `.hook-core-version` / `package.json` / `hooks/VERSION` / `regression-contract.yaml`（6 处 bump 15.0.0）
- `packages/engine/feature-registry.yml`（新增 4 条 skill entry + changelog）

**删除**：
- `steps/03-integrate.md`（Stage 3 冗余）
- `steps/00-worktree-auto.md` / `steps/00.5-enrich.md` / `steps/00.7-decision-query.md` / `steps/04-ship.md`（逻辑全部 migrate 到新 skill）

**部署 symlinks**（本 PR 合并后手工跑 deploy 一次）：
- `~/.claude/skills/engine-worktree` → `packages/engine/skills/engine-worktree`（+ enrich/decision/ship 各一条）

## 不做

- 不做 Engine plugin 化
- 不改 Superpowers 任何代码
- 不改 Stop Hook / orphan-pr-worker / worktree-manage.sh 的 bash 逻辑（只搬家，逻辑原样）
- 不改 Brain 代码
- 不改 CI workflow（engine-ci.yml 不动）

## 假设

- Claude Code 本地 skill 识别机制：`~/.claude/skills/<skill-name>/SKILL.md` 可被 `Skill({"skill":"<skill-name>"})` 激活（由 /dev 的现有行为证实）
- 3 账户的 `~/.claude-accountX/skills` 都是 `~/.claude/skills` 的 symlink（已验证）
- autonomous-research-proxy Tier 1 默认 "finishing Option 2 = push+PR" 稳定
- `bump-version.sh` 能一键处理 6 处版本同步

## DoD

- [ ] [ARTIFACT] 4 个新 skill 目录 + SKILL.md 存在
  Test: manual:node -e "const fs=require('fs');['engine-worktree','engine-enrich','engine-decision','engine-ship'].forEach(n=>{fs.accessSync('packages/engine/skills/'+n+'/SKILL.md')});"
- [ ] [ARTIFACT] 4 个新 skill 的 SKILL.md 结尾含 TERMINAL IMPERATIVE 硬指令块
  Test: manual:node -e "const fs=require('fs');['engine-worktree','engine-enrich','engine-decision','engine-ship'].forEach(n=>{const c=fs.readFileSync('packages/engine/skills/'+n+'/SKILL.md','utf8');if(!c.includes('TERMINAL IMPERATIVE'))process.exit(1)});"
- [ ] [ARTIFACT] steps/03-integrate.md 不存在
  Test: manual:node -e "const fs=require('fs');try{fs.accessSync('packages/engine/skills/dev/steps/03-integrate.md');process.exit(1)}catch(e){}"
- [ ] [ARTIFACT] 原 4 个 step 文件 (00/00.5/00.7/04) 已删
  Test: manual:node -e "const fs=require('fs');['00-worktree-auto','00.5-enrich','00.7-decision-query','04-ship'].forEach(s=>{try{fs.accessSync('packages/engine/skills/dev/steps/'+s+'.md');process.exit(1)}catch(e){}});"
- [ ] [ARTIFACT] Engine 6 处版本都是 15.0.0
  Test: manual:bash scripts/check-version-sync.sh
- [ ] [ARTIFACT] feature-registry.yml 含 15.0.0 changelog
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('15.0.0'))process.exit(1)"
- [ ] [BEHAVIOR] 新 skill 单独可激活 + /dev 接力链真通
  Test: tests/engine/skill-chain-integration.test.ts
- [ ] [ARTIFACT] Learning 文件存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-04191750-engine-skillification.md')"
