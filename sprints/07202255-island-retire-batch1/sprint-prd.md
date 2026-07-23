# Sprint PRD：孤岛退役批次1

**任务 ID**: c3adb5e6-3b80-4682-8362-15ac086b06ea
**创建时间**: 2026-07-23
**优先级**: P2
**类型**: 纯删除 / 清理（无功能变更）

---

## 背景

四十孤岛档案馆拍板后首批退役。三组文件经四线验证（引用扫描 + test 覆盖 + 路由解析 + git 历史）全部阴性，确认为真死件：

1. `packages/workflows/n8n/archive/` — 9 个 N8N 史前 JSON（N8N live 后继在 `workflows/{cecelia,tools}`）
2. `packages/engine/src/harness/{runner,evaluate,e2e-judge}.js` — 2026-06-12 三权分立实验死簇，无 test、engine 外零引用
3. `apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx` + `apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx` — 2026-07-13 重复桩，runtime 已路由到 `@features/core/execution/pages/` 版本

---

## 目标文件清单

### 组 A：n8n archive（9 个 JSON）
```
packages/workflows/n8n/archive/clean-task-dispatcher.json
packages/workflows/n8n/archive/clean-feature-completion-sync.json
packages/workflows/n8n/archive/cecelia-callback-handler-v2.1.json
packages/workflows/n8n/archive/devgate-nightly-push.json
packages/workflows/n8n/archive/clean-feature-entry-checker.json
packages/workflows/n8n/archive/clean-feature-completion-sync-2.json
packages/workflows/n8n/archive/clean-completion-sync-v1.json
packages/workflows/n8n/archive/prd-executor.json
packages/workflows/n8n/archive/cecelia-launcher-v2.json
```

### 组 B：engine/src/harness 死簇（3 个 JS）
```
packages/engine/src/harness/runner.js
packages/engine/src/harness/evaluate.js
packages/engine/src/harness/e2e-judge.js
```
> 注意：`evaluate.js` 内部 `import { executeAndRecord } from './runner.js'`，`judgeExecution` 被 `evaluate.js` 调用——三文件互为死簇，一并删除。engine 外无任何引用（CI grep 证实）。

### 组 C：dashboard 重复桩（2 个 TSX）
```
apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx
apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx
```
> 注意：`index.ts` re-export 桩保留（运行时 / 测试仍通过 index 导入，实现已指向 `@features/core/...`）。仅删桩文件本身。

---

## 累积 FR

> 本任务为纯删除/清理，无新增功能 FR。

**FR-DEL-01**: 删除 `packages/workflows/n8n/archive/` 下全部 9 个 JSON 文件
**FR-DEL-02**: 删除 `packages/engine/src/harness/` 下 3 个 JS 文件（runner / evaluate / e2e-judge）
**FR-DEL-03**: 删除 `apps/dashboard/src/pages/test-pyramid/TestPyramidPage.tsx`
**FR-DEL-04**: 删除 `apps/dashboard/src/pages/relay-progress/RelayProgressPage.tsx`
**FR-VERIFY-01**: 删除前执行全局引用扫描，确认无未预期引用残留
**FR-VERIFY-02**: 删除后 dashboard build 通过（`npm run build`）
**FR-VERIFY-03**: 删除后 CI 全绿（engine-ci / workspace-ci）

---

## NFR

NFR: N/A（纯删除任务，无性能/安全/并发 NFR）

---

## Invariant 约束

（从 Brain DB invariants 表加载，79 条中筛选相关 7 条）

**INV-1 退役判断数据不靠记忆**：退役决策必须靠查生产库实锤（grep 引用 / 路由解析 / test 扫描），不依赖记忆。本次已完成：四线验证阴性后拍板。

**INV-2 铁律：停手优先于强删**：发现任何文件有未预期引用（grep 命中任何非测试的真实生产路径），立即停手报告，不强行删除。

**INV-3 复活前读死因代码**：若未来需复活上述任何模块，须先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前真实代码，逐字核对 death cause（不能只信退役 commit message）。

**INV-4 部署链失败路径禁止 warning 降级**：删除 + CI 验证链任何失败路径须显式 FAIL + exit 非零，不允许静默通过。

**INV-5 替换/删除驱动须 grep 所有副作用调用点**：删除 harness 死簇前，须 grep 旧入口函数在整个 repo 的调用点，确认无生产引用方可删。（已执行：engine 外零引用）

**INV-6 退役分批、每批独立验收**：本次为批次1（最安全批）。后续批次须独立 PR + 独立 CI 验收，不与本批合并。

**INV-7 表/文件认领冲突前先 grep 全写入方**：删除文件前确认无多方写入（n8n archive JSON 为只读归档，无写入方）。

---

## 验收标准

| # | 验收项 | 方法 | 预期结果 |
|---|--------|------|----------|
| A1 | 无引用残留：n8n archive JSON | `grep -r "n8n/archive" /workspace --include="*.js" --include="*.ts" --include="*.sh"` | 0 命中 |
| A2 | 无引用残留：harness runner/evaluate/e2e-judge | `grep -r "harness/runner\|harness/evaluate\|harness/e2e-judge" /workspace --include="*.js" --include="*.ts"` | 0 命中（组内互引已随文件删除消失） |
| A3 | 无引用残留：TestPyramidPage / RelayProgressPage tsx | `grep -r "from.*TestPyramidPage\|from.*RelayProgressPage" /workspace/apps/dashboard/src --include="*.ts" --include="*.tsx"` | 0 命中（index.ts re-export 桩不计，因实现已指向 features） |
| A4 | Dashboard build 通过 | `cd apps/dashboard && npm run build` | exit 0，无 TypeScript/Vite 报错 |
| A5 | CI 全绿 | GitHub Actions engine-ci + workspace-ci | status: success |
| A6 | 文件实际已删除 | `ls` 各目标路径 | No such file |

**铁律**：如 A1/A2/A3 任一出现非预期命中，立即停手，不执行删除，报告具体命中内容。

---

## 执行顺序

1. 全局引用扫描（先验证后删）
2. 删除组 A（n8n archive 9 JSON）— 最低风险，先做
3. 删除组 B（engine harness 3 JS）
4. 删除组 C（dashboard 2 TSX 桩）
5. `npm run build`（dashboard）
6. PR + CI 验收

---

## 不在本批次范围内

- `apps/dashboard/src/pages/test-pyramid/index.ts`（re-export 桩保留）
- `apps/dashboard/src/pages/relay-progress/index.ts`（re-export 桩保留）
- `apps/dashboard/src/pages/test-pyramid/__tests__/`（测试文件保留）
- `apps/dashboard/src/pages/relay-progress/__tests__/`（测试文件保留）
- 任何 n8n/active/ 工作流
- packages/engine/src/harness/ 目录本身（仅删 3 个 JS，目录可能为空后自动废弃）

---

journey_type: cleanup
target_environment: local_api
