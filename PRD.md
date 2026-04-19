# PRD: Engine Phase 6 — Slim & Unblock（15.0.0 → 16.0.0）

## 背景

Phase 5 (#2423) 实现 TERMINAL IMPERATIVE 接力，但审计暴露：

**阻碍**：
1. Phase 5 /dev SKILL.md 删了"读 autonomous-research-proxy.md"指令 → proxy 211 行规则没人读 → brainstorming 问 clarifying question 时主 agent 停下等用户 → autonomous 死锁
2. engine-decision 写 `.decisions-<branch>.yaml` 但 Superpowers subagent 不读 → 白写
3. engine-enrich 的 "5 自问 + 3 轮 review + 探索代码库" 一字不差复制 brainstorming

**垃圾**：748 行里 74% 噪音。

## 真实目的

Engine skill 瘦到真正独有的最小集（worktree + ship），其他能力下放 autonomous-research-proxy 的 Tier 规则。

## 成功标准

1. 接力链 9 棒 → 7 棒：/dev → engine-worktree → superpowers:brainstorming → ... → engine-ship
2. 删 engine-enrich + engine-decision
3. proxy 加 Tier 1 新规则（enrich-decide + decisions/match）
4. /dev ≤35 行，proxy ≤100 行，engine-worktree ≤45 行，engine-ship ≤65 行
5. 版本 15.0.0 → 16.0.0

## 涉及文件

- 删除：engine-enrich/ + engine-decision/ + decision-query-step.test.ts
- 修改：dev/SKILL.md + engine-worktree/SKILL.md + engine-ship/SKILL.md + autonomous-research-proxy.md + 6 处版本 + feature-registry.yml
- 保留：enrich-decide.sh + Brain decisions/match API

## 不做

- 不改 Superpowers / Brain / Stop Hook / CI

## DoD

- [ ] [ARTIFACT] engine-enrich 目录不存在
  Test: manual:node -e "try{require('fs').accessSync('packages/engine/skills/engine-enrich');process.exit(1)}catch(e){}"
- [ ] [ARTIFACT] engine-decision 目录不存在
  Test: manual:node -e "try{require('fs').accessSync('packages/engine/skills/engine-decision');process.exit(1)}catch(e){}"
- [ ] [ARTIFACT] /dev SKILL.md ≤ 40 行
  Test: manual:node -e "const l=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8').split('\n').length;if(l>40)process.exit(1)"
- [ ] [ARTIFACT] proxy ≤ 110 行
  Test: manual:node -e "const l=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8').split('\n').length;if(l>110)process.exit(1)"
- [ ] [ARTIFACT] engine-worktree ≤ 50 行
  Test: manual:node -e "const l=require('fs').readFileSync('packages/engine/skills/engine-worktree/SKILL.md','utf8').split('\n').length;if(l>50)process.exit(1)"
- [ ] [ARTIFACT] engine-ship ≤ 70 行
  Test: manual:node -e "const l=require('fs').readFileSync('packages/engine/skills/engine-ship/SKILL.md','utf8').split('\n').length;if(l>70)process.exit(1)"
- [ ] [ARTIFACT] engine-worktree TERMINAL IMPERATIVE 指向 superpowers:brainstorming
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/engine-worktree/SKILL.md','utf8');if(!c.includes('superpowers:brainstorming'))process.exit(1)"
- [ ] [ARTIFACT] proxy 含 enrich + decision 新规则
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');if(!c.includes('enrich-decide')||!c.includes('decisions/match'))process.exit(1)"
- [ ] [ARTIFACT] Engine 6 处版本都是 16.0.0
  Test: manual:node -e "const fs=require('fs');['packages/engine/VERSION','packages/engine/.hook-core-version','packages/engine/hooks/VERSION'].forEach(f=>{if(fs.readFileSync(f,'utf8').trim()!=='16.0.0')process.exit(1)})"
- [ ] [ARTIFACT] feature-registry 含 16.0.0
  Test: manual:node -e "if(!require('fs').readFileSync('packages/engine/feature-registry.yml','utf8').includes('16.0.0'))process.exit(1)"
- [ ] [BEHAVIOR] /dev SKILL.md 含 autonomous 行为 inline 核心条款
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(!c.includes('Research Subagent')||!c.includes('不停下'))process.exit(1)"
- [ ] [ARTIFACT] Learning 文件存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-04191850-phase6-slim.md')"
