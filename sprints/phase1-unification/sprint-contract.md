# Sprint Contract: Phase 1 模式统一

> Harness v4.3 格式
> Version: 1.0.0
> Created: 2026-04-18
> Branch: cp-0418xxxx-phase1-dev-mode-unification
> Upstream PRD: `docs/PRD.md`
> Upstream DoD: `docs/task-card.md`

---

## 功能范围

### 本 Sprint 做什么

1. 合并 `/dev` 的「标准模式」与「autonomous_mode」为单一默认流水线（始终 Superpowers 三角色 subagent-driven-development）
2. 从 `devloop-check.sh` / `SKILL.md` / `steps/*.md` / `parse-dev-args.sh` 清理 `autonomous_mode` 字段读取与分支文案
3. 保留 `harness_mode: true` 快速通道（Brain harness pipeline 仍能派发）
4. 新增 `packages/brain/src/orphan-pr-worker.js`：扫开放 `cp-*` PR，年龄 > 2h 且无对应 in_progress task 的孤儿 PR 按 CI 状态处理（green → auto-merge；fail → label + alert）
5. `tick.js` 集成 orphan-pr-worker，每 30 分钟触发一次（沿用 `cleanup-worker` 节流模式）
6. Engine 5 处版本号 bump（minor）+ `feature-registry.yml` 新增 changelog 条目 `phase1-dev-mode-unification`
7. `parse-dev-args.sh --autonomous` flag 降级为 no-op + stderr warn（向后兼容）
8. 写 Learning：`docs/learnings/cp-0418xxxx-phase1-dev-mode-unification.md`

### 本 Sprint 不做什么

- 不删除 `harness_mode`（Phase 2 才做）
- 不修改 Harness Evaluator 合同（`harness-evaluator/SKILL.md` 零改动）
- 不新增 CI job（不引入 alignment-gate 类新门禁）
- 不处理 non-cp-* branch 的 PR
- 不做 orphan-pr-worker Dashboard UI（只写 alerts 表）
- 不修改 Superpowers 本地化副本或 sha256 契约（#2406 职责）
- 不推送到 main，不用 `--admin`，CI 必须 green 后常规合并

---

## Workstreams

Sprint 切分为 3 个 Workstream，以「/dev 文档面 + 代码面 + Brain 兜底」切面垂直拆分：

### WS1: /dev 模式统一 — 文档 + 脚本

**本 WS 动作**：
- `packages/engine/skills/dev/SKILL.md`：合并两个「流程」章节为单一 `## 流程`（保留 autonomous 三角色流水线），description / changelog 去"支持 autonomous_mode"
- `packages/engine/skills/dev/steps/02-code.md`：删除「主 agent 直写」分支或标为废弃，统一走 Superpowers subagent-driven-development
- `packages/engine/skills/dev/steps/autonomous-research-proxy.md`：顶部说明从条件加载改为"默认加载"
- `packages/engine/skills/dev/steps/01-spec.md` / `00.5-enrich.md`：清理 `autonomous_mode` 条件分支
- `packages/engine/skills/dev/scripts/parse-dev-args.sh`：`--autonomous` flag 降级为 no-op + stderr warn
- `packages/engine/feature-registry.yml`：加 changelog 条目
- Engine 5 处版本号 bump（minor）

**产出**：
- SKILL.md / steps 统一
- parse-dev-args.sh 兼容降级
- 版本号同步

**DoD**：`contract-dod-ws1.md`（分节「/dev 模式统一（删除 Standard）」+「版本号同步」）

### WS2: /dev 代码面 — devloop-check 清理

**本 WS 动作**：
- `packages/engine/lib/devloop-check.sh`：
  - 删除 `autonomous_mode` 读取 / 分支判断代码
  - 保留 `harness_mode` 分支（SC-3.1 明确要求）
  - 注释保留「harness_mode 快速通道」说明
- 确保现有 `packages/engine/tests/` 下 devloop 相关测试仍绿

**产出**：
- devloop-check.sh 瘦身（autonomous_mode 行数 = 0）
- harness_mode 分支测试覆盖（若已存在则验证不破坏，未覆盖则补）

**DoD**：`contract-dod-ws2.md`（分节「向后兼容 — harness_mode 保留」+「回归 DevGate 全绿」）

### WS3: Brain orphan-pr-worker + tick.js 集成

**本 WS 动作**：
- 新增 `packages/brain/src/orphan-pr-worker.js`：
  - 导出 `scanOrphanPrs(opts)` 函数
  - `opts.dryRun` 支持
  - `opts.ageThresholdMs` 默认 `2 * 60 * 60 * 1000`
  - `opts.timeoutMs` 默认 120 秒
  - 内部流程：`gh pr list` → 过滤年龄 → 查 Brain tasks → 按 CI 状态 merge/label/alert
  - CLI 入口：`node packages/brain/src/orphan-pr-worker.js --dry-run` 可独立执行
- 新增 `packages/brain/src/__tests__/orphan-pr-worker.test.js`：
  - young PR is skipped
  - PR with matching in_progress task is skipped
  - orphan PR with green CI would merge
  - orphan PR with failing CI would label and alert
- `packages/brain/src/tick.js`：
  - 仿照 `cleanup-worker` 的 `_lastCleanupWorkerTime` 节流模式
  - 加 `_lastOrphanPrWorkerTime`，30 分钟周期（`1800_000` ms）
  - import `scanOrphanPrs`，按节流间隔调用
- 写 Learning 文件

**产出**：
- orphan-pr-worker.js + 单测
- tick.js 集成 patch
- Learning 文件

**DoD**：`contract-dod-ws3.md`（分节「Brain orphan-pr-worker」+「单元测试覆盖要点」+「新增文件」）

---

## Workstream 依赖关系

```
WS1 (/dev 文档 + 脚本)   WS2 (/dev 代码面 — devloop-check)
        |                        |
        |  产出: SKILL.md 统一      |  产出: devloop-check.sh 瘦身
        |  parse-dev-args 兼容     |  harness_mode 保留
        |                        |
        +---- 均为 /dev 域 -------+
                  |
                  v
        WS3 (Brain orphan-pr-worker)
             (独立域，可与 WS1/WS2 并行)
                  |
                  v
              PR 提交 → CI green → Merge
```

- **WS1 与 WS2 可并行**（同域不同文件，不冲突；都属 `packages/engine/`）
- **WS3 与 WS1/WS2 可并行**（不同 package，完全独立）
- 合入 PR 前需确保：WS1 + WS2 合并后 `devloop-check.sh` 的 autonomous_mode 清零 + SKILL.md 统一说法成立

---

## 验证命令（Evaluator 逐条执行）

Evaluator 按以下顺序执行，任一非零退出即 FAIL：

1. `bash scripts/check-version-sync.sh`
2. `node scripts/facts-check.mjs`
3. `node packages/engine/scripts/devgate/check-dod-mapping.cjs`
4. `node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(c.includes('autonomous_mode'))process.exit(1)"`
5. `node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('harness_mode'))process.exit(1)"`
6. `node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(c.includes('流程（标准模式）')||c.includes('流程（autonomous_mode）'))process.exit(1)"`
7. `node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(!/^## 流程\s*$/m.test(c))process.exit(1)"`
8. `node -e "require('fs').accessSync('packages/brain/src/orphan-pr-worker.js')"`
9. `node -e "const m=require('./packages/brain/src/orphan-pr-worker.js');if(typeof m.scanOrphanPrs!=='function')process.exit(1)"`
10. `node packages/brain/src/orphan-pr-worker.js --dry-run`
11. `npx vitest run packages/brain/src/__tests__/orphan-pr-worker.test.js`
12. `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes('orphan-pr-worker')||!c.includes('scanOrphanPrs'))process.exit(1)"`
13. `node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('phase1-dev-mode-unification'))process.exit(1)"`
14. `bash -c "bash packages/engine/skills/dev/scripts/parse-dev-args.sh --autonomous /tmp/fake-prd.md 2>&1 | node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{if(!/deprecated|no-op/i.test(d))process.exit(1)})'"`
15. `node -e "const c=require('fs').readFileSync('docs/learnings/cp-0418xxxx-phase1-dev-mode-unification.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

---

## 通过标准

- 上述 15 条验证命令全部 exit 0
- CI engine-ci.yml + brain-ci.yml 全绿
- `/dev` 文档面只保留单一「流程」章节（无「标准模式」/「autonomous_mode」二分叙述）
- `devloop-check.sh` 的 autonomous_mode 引用清零，harness_mode 分支完整保留
- Brain orphan-pr-worker 在 tick.js 中按 30 分钟节流调度
- 向后兼容：`--autonomous` flag 仍可接受（no-op + warn），Brain payload 带 `autonomous_mode: true` 不报错
