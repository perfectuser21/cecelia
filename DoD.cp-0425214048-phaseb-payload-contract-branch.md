task_id: 1d37b05f-f367-4c92-876d-8245db7ebdd8
branch: cp-0425214048-phaseb-payload-contract-branch

## 任务标题
[Harness v6 P0-final] Phase B 入库 sub-task 时 set payload.contract_branch

## 任务描述

P1-D 修了 `harness-task-dispatch.js` 注入 CONTRACT_BRANCH env，但运行时 env 仍是空字符串 → Generator 容器 ABORT（'CONTRACT_BRANCH 未定义'）。

实证: bb245cb4 / 576f6cf4 两次 Initiative，所有 Gen 容器都 ABORT。

漏点链路（5 跳全断）：
1. proposer 节点不解析 stdout 的 `propose_branch`
2. `GanContractState` 无对应 Annotation
3. `runGanContractGraph` 返回值无 `propose_branch`
4. `harness-initiative.graph.js` 无法透传给 `upsertTaskPlan`
5. `upsertTaskPlan` 也不接受 contractBranch 参数

本 PR 把 5 跳全补上 + 加 `initiative_contracts.branch` 列做 SSOT（migration 246）。

## DoD

- [x] [ARTIFACT] migration 246 文件存在且含 ALTER TABLE ADD COLUMN branch
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/246_add_branch_to_initiative_contracts.sql','utf8');if(!c.includes('ADD COLUMN IF NOT EXISTS branch'))process.exit(1)"

- [x] [ARTIFACT] upsertTaskPlan 接受 contractBranch 参数并条件性写入 payload
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-dag.js','utf8');if(!c.includes('contractBranch = null')||!c.includes('payload.contract_branch = contractBranch'))process.exit(1)"

- [x] [ARTIFACT] GAN graph 暴露 extractProposeBranch + GanContractState 含 proposeBranch
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes('extractProposeBranch')||!c.includes('proposeBranch:'))process.exit(1)"

- [x] [ARTIFACT] runGanContractGraph 返回值含 propose_branch 字段
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!c.includes('propose_branch: finalState.proposeBranch'))process.exit(1)"

- [x] [ARTIFACT] harness-initiative.graph.js 两个 upsertTaskPlan 调用点都传 contractBranch
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/contractBranch:\s*\S+propose_branch/g)||[];if(m.length<2)process.exit(1)"

- [x] [ARTIFACT] initiative_contracts INSERT 写入 branch 列（runInitiative + dbUpsertNode 两处）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const m=c.match(/budget_cap_usd, timeout_sec, branch, approved_at/g)||[];if(m.length<2)process.exit(1)"

- [x] [BEHAVIOR] 单元测试: 4 sub-task 创建后每个 payload.contract_branch === approved_contract.branch
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-dag-contract-branch.test.js','utf8');if(!c.includes('contractBranch 非空')||!c.includes('payload.contract_branch')||!c.includes('toBe(branch)'))process.exit(1)"

- [x] [BEHAVIOR] GAN graph 单元测试: proposer stdout 含 propose_branch → finalState 透传到 runGanContractGraph 返回值
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-gan-graph.test.js','utf8');if(!c.includes('extractProposeBranch')||!c.includes('propose_branch'))process.exit(1)"

- [x] [ARTIFACT] selfcheck.js EXPECTED_SCHEMA_VERSION bump 到 246 + DEFINITION.md 同步
  Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');const d=require('fs').readFileSync('DEFINITION.md','utf8');if(!s.includes(\"EXPECTED_SCHEMA_VERSION = '246'\")||!d.includes('Schema 版本: 246'))process.exit(1)"

- [x] [ARTIFACT] Learning 文档存在且含根本原因 + 下次预防
  Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0425214048-phaseb-payload-contract-branch.md','utf8');if(!c.includes('根本原因')||!c.includes('下次预防'))process.exit(1)"

## 目标文件

- packages/brain/migrations/246_add_branch_to_initiative_contracts.sql（新建）
- packages/brain/src/harness-dag.js（修改 upsertTaskPlan 签名 + payload）
- packages/brain/src/workflows/harness-gan.graph.js（GanContractState + proposer + return + extractProposeBranch）
- packages/brain/src/workflows/harness-initiative.graph.js（两个 upsertTaskPlan 调用点 + initiative_contracts INSERT）
- packages/brain/src/__tests__/harness-dag-contract-branch.test.js（新建）
- packages/brain/src/__tests__/harness-gan-graph.test.js（追加 propose_branch 用例）
- packages/brain/src/selfcheck.js（EXPECTED_SCHEMA_VERSION 246）
- DEFINITION.md（schema_version 246）
- docs/learnings/cp-0425214048-phaseb-payload-contract-branch.md（新建）
- docs/superpowers/specs/2026-04-25-phaseB-contract-branch-payload-design.md（新建）
- docs/superpowers/plans/2026-04-25-phaseB-contract-branch-payload.md（新建）
