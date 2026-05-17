# Sprint Contract: L2 动态契约 — Evidence System + TDD Artifact

> Harness v4.3 格式
> Version: 1.0.0
> Created: 2026-04-18
> Branch: cp-04181830-r7-superpowers-gap（follow-up of PR #2406）
> Upstream PRD: `docs/PRD.md`
> Upstream DoD: `docs/DoD.md`

---

## 功能范围

### 本 Sprint 做什么

1. 定义 Evidence JSONL Schema（10 event types 封闭集合 + 完整 JSON example）
2. 新增 `packages/engine/scripts/record-evidence.sh`（带 sha256 防伪造、event 白名单、必填字段校验）
3. 新增 `packages/engine/scripts/devgate/check-pipeline-evidence.cjs`（opt-in / enforced 双模式）+ 单元测试 ≥ 5 case
4. 扩展 `superpowers-alignment.yaml`：10 个 full-coverage skill 追加 `runtime_evidence` 字段（全部 `mode: opt-in`）
5. 修改 `implementer-prompt.md`（新增 TDD 交付物段落）+ `spec-reviewer-prompt.md`（新增第 6 项 checklist）
6. 在 `02-code.md` 关键点插入 5-7 处 `record-evidence.sh` 调用
7. CI 集成：新增 `pipeline-evidence-gate` step（opt-in 不阻塞合并）
8. 版本号 5 处同步 + feature-registry 登记 `R8-l2-dynamic-contract`
9. 写 Learning：`docs/learnings/cp-04181830-l2-dynamic-contract.md`

### 本 Sprint 不做什么

- 不把任何 skill 转 `enforced`（本轮全 opt-in，enforce 迁移放 R8+）
- 不引入新 Brain 表（evidence 直接进 git 仓库内 JSONL）
- 不改 /dev Stage 1 / Stage 3 / Stage 4 流程（只在 Stage 2 插桩）
- 不改 PR #2406 已落地契约字段（仅**追加** runtime_evidence 子字段）
- 不新增 MAX event 数量限制
- 不做过期清理机制（JSONL 随 branch 生命周期自然消亡）

---

## Workstreams

Sprint 并行切分为 6 个 Workstream，对应 T1-T5 预制件 + 本 team 的 CI 集成：

### WS1: Evidence Schema + 契约扩展（T1 产出）

**输入（上游预制件）**：
- T1 产出：`pipeline-evidence-schema.md` 10 event types 定义 + JSON example
- T1 产出：`superpowers-alignment.yaml` 的 `runtime_evidence` 字段补丁（10 个 full skill）

**本 WS 动作**：
- 将 T1 schema 文档落到 `docs/engine/pipeline-evidence-schema.md`
- 将 T1 契约补丁 apply 到 `packages/engine/contracts/superpowers-alignment.yaml`（**追加** runtime_evidence，不删老字段）
- 所有 `runtime_evidence.mode` 强制 `opt-in`（禁止任何 enforced）
- `test-driven-development` 必含 `tdd_red` + `tdd_green`；`subagent-driven-development` 必含 `subagent_dispatched` + `subagent_returned`
- 跑 L1 gate (`check-superpowers-alignment.cjs`) 验证向后兼容

**DoD**：`contract-dod-ws1.md`

### WS2: record-evidence.sh recorder（T2 产出）

**输入（上游预制件）**：
- T2 产出：`record-evidence.sh` 脚本草案（含参数解析、event 白名单、sha256 自动计算、JSONL append）

**本 WS 动作**：
- 将 T2 脚本落到 `packages/engine/scripts/record-evidence.sh`（chmod +x）
- 自动读 `.dev-mode` 的 `task_id` + `branch`（调用方不用手传）
- 参数校验：非白名单 event → exit 非零；event-specific 必填字段缺失 → exit 非零
- sha256 由脚本对 `--prompt <path>` 指向文件自动计算，禁止手传 hash
- JSONL append 到 `$WORKTREE/.pipeline-evidence.<branch>.jsonl`（支持 `--output` 覆盖用于测试）
- 本地手工跑一次冒烟：成功产出合法单行 JSON

**DoD**：`contract-dod-ws2.md`

### WS3: CI gate 脚本 + 单元测试（T3 产出）

**输入（上游预制件）**：
- T3 产出：`check-pipeline-evidence.cjs` 脚本草案 + vitest 测试 fixture

**本 WS 动作**：
- 将 T3 脚本落到 `packages/engine/scripts/devgate/check-pipeline-evidence.cjs`
- 读 `superpowers-alignment.yaml` 中每个 full skill 的 `runtime_evidence.required_events`
- 读 `sprints/<branch>/pipeline-evidence.jsonl` 或 worktree 下 `.pipeline-evidence.*.jsonl`
- 按 skill 校验 required_events 覆盖（correlation on `task_id`）+ `assert_fields` 存在
- 缺 event 时根据 `mode`：opt-in → stdout warn + exit 0；enforced → stderr fail + exit 非零
- 单元测试至少 5 case：全覆盖 pass / opt-in 缺失 warn / enforced 缺失 fail / 非法 JSON 行 fail / required_events schema mismatch fail
- `tests/engine/devgate/pipeline-evidence.test.ts` 落地

**DoD**：`contract-dod-ws3.md`

### WS4: 02-code.md 关键点插桩（T4 产出）

**输入（上游预制件）**：
- T4 产出：02-code.md 补丁（5-7 处 record-evidence 调用，行级 diff）

**本 WS 动作**：
- 将 T4 补丁 apply 到 `packages/engine/skills/dev/02-code.md`
- 插桩点覆盖：Stage 2 开始派发 Implementer 前 + Implementer 返回后 + TDD red + TDD green + Spec Reviewer 派发前后 + verification-before-completion 过关
- 每处插桩使用 `bash packages/engine/scripts/record-evidence.sh --event <e> --prompt <p> --output <o>` 统一调用形式
- 插桩失败不阻断主流程（append 失败只 warn log）
- 本地跑一次假 /dev 模拟：看 `.pipeline-evidence.*.jsonl` 能否真实产生

**DoD**：`contract-dod-ws4.md`

### WS5: Prompt 改动（T5 产出）

**输入（上游预制件）**：
- T5 产出：`implementer-prompt.md` 新增 TDD 段落 + `spec-reviewer-prompt.md` 新增第 6 项 checklist

**本 WS 动作**：
- 将 T5 补丁 apply 到 `packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md` + `spec-reviewer-prompt.md`
- Implementer 段落强制：先 tdd_red → 再 tdd_green → 返回 DONE 附 `tdd_red_commit_sha` + `tdd_green_commit_sha`
- Spec Reviewer 第 6 项：检查 pipeline-evidence.jsonl 中有配对 tdd_red + tdd_green 且 red 在 green 之前
- 修改后重新计算两个 prompt 的 sha256，回写 `superpowers-alignment.yaml` 的 `local_prompt_sha256` 字段
- 跑 L1 gate 验证 sha256 一致

**DoD**：`contract-dod-ws5.md`

### WS6: CI 集成 + 版本 bump + feature-registry（本 team 起草）

**输入**：
- WS1-WS5 全部落地
- PR #2406 已合入 main（L1 gate 可用）

**本 WS 动作**：
- `.github/workflows/ci.yml`（或 `engine-ci.yml`）新增 `pipeline-evidence-gate` step
- step 执行 `node packages/engine/scripts/devgate/check-pipeline-evidence.cjs`
- step 在 opt-in 阶段 exit 0 即通过，不阻塞合并
- 版本号 5 处同步 bump（package.json / package-lock.json / VERSION / .hook-core-version / regression-contract.yaml）
- `feature-registry.yml` 新增 `R8-l2-dynamic-contract` changelog 条目
- 跑 `bash packages/engine/scripts/generate-path-views.sh`（Engine skills 改动三要素）
- 写 Learning `docs/learnings/cp-04181830-l2-dynamic-contract.md`（`### 根本原因` + `### 下次预防`）

**DoD**：`contract-dod-ws6.md`

---

## Workstream 依赖关系

```
WS1 (Schema + 契约扩展)    WS2 (recorder)    WS3 (check gate + tests)    WS5 (Prompt 改动)
       |                       |                    |                         |
       |  产出: runtime_evidence |  产出: JSONL append |  产出: check + 5 case   |  产出: prompt + 新 sha256
       |                       |                    |                         |
       +----------+            |                    |                         |
                  v            v                    v                         v
                  WS4 (02-code.md 插桩) --- 依赖 WS2 recorder 脚本路径
                          |
                          v
                  WS6 (CI 集成 + bump + registry + Learning)
                          |
                          v
                     PR 提交 → CI green → Merge
```

- **并行**：WS1 / WS2 / WS3 / WS5 四个 WS 完全独立，可并行推进
- **晚于**：WS4（插桩）必须晚于 WS2（需要 recorder 脚本的实际命令签名）
- **最终合流**：WS6 必须晚于 WS1-WS5 全部，CI gate 调的是 WS3 脚本，读的是 WS1 契约

---

## 验证命令（Evaluator 逐条执行）

Evaluator 按以下顺序执行，任一非零退出即 FAIL：

1. `test -f docs/engine/pipeline-evidence-schema.md`
2. `test -f packages/engine/scripts/record-evidence.sh`
3. `test -f packages/engine/scripts/devgate/check-pipeline-evidence.cjs`
4. `test -f tests/engine/devgate/pipeline-evidence.test.ts`
5. `node -e "const c=require('fs').readFileSync('docs/engine/pipeline-evidence-schema.md','utf8');['brainstorm_started','brainstorm_committed','plan_written','plan_executed','subagent_dispatched','subagent_returned','tdd_red','tdd_green','verification_passed','review_requested'].forEach(e=>{if(!c.includes(e))process.exit(1)})"`
6. `bash packages/engine/scripts/record-evidence.sh --event subagent_dispatched --subagent-type implementer --prompt packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md --task-id 00000000-0000-0000-0000-000000000000 --branch test --output /tmp/evalr-evidence.jsonl`
7. `node -e "const o=JSON.parse(require('fs').readFileSync('/tmp/evalr-evidence.jsonl','utf8').trim());if(o.event!=='subagent_dispatched'||!/^[0-9a-f]{64}$/.test(o.prompt_sha256))process.exit(1)"`
8. `node packages/engine/scripts/devgate/check-pipeline-evidence.cjs`
9. `node packages/engine/scripts/devgate/check-superpowers-alignment.cjs`
10. `node -e "const y=require('js-yaml');const c=y.load(require('fs').readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8'));const full=c.skills.filter(s=>s.coverage_level==='full');if(full.length<10)process.exit(1);for(const s of full){if(!s.runtime_evidence||s.runtime_evidence.mode!=='opt-in'||!Array.isArray(s.runtime_evidence.required_events))process.exit(1)}"`
11. `node -e "const y=require('js-yaml');const c=y.load(require('fs').readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8'));const tdd=c.skills.find(s=>(s.name||s.skill)==='test-driven-development');const evs=tdd.runtime_evidence.required_events.map(e=>e.event);if(!evs.includes('tdd_red')||!evs.includes('tdd_green'))process.exit(1)"`
12. `node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md','utf8');if(!c.includes('tdd_red')||!c.includes('tdd_green'))process.exit(1)"`
13. `node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md','utf8');if(!c.includes('pipeline-evidence')||!c.includes('tdd_red'))process.exit(1)"`
14. `node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/02-code.md','utf8');const m=c.match(/record-evidence\.sh/g)||[];if(m.length<5)process.exit(1)"`
15. `npm test -- tests/engine/devgate/pipeline-evidence.test.ts`
16. `node -e "const fs=require('fs');let ok=false;for(const f of ['.github/workflows/ci.yml','.github/workflows/engine-ci.yml']){try{if(fs.readFileSync(f,'utf8').includes('pipeline-evidence-gate'))ok=true}catch{}}if(!ok)process.exit(1)"`
17. `node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('R8-l2-dynamic-contract'))process.exit(1)"`
18. `bash packages/engine/scripts/check-version-sync.sh`
19. `node -e "const c=require('fs').readFileSync('docs/learnings/cp-04181830-l2-dynamic-contract.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

---

## 通过标准

- 上述 19 条验证命令全部 exit 0
- CI `pipeline-evidence-gate` 在最后一次 push 上 green（opt-in 即 exit 0）
- L1 gate (`check-superpowers-alignment`) 未被本次改动破坏（向后兼容）
- 合并后下次真实 /dev 任务运行时，worktree 内产出 `.pipeline-evidence.<branch>.jsonl` 且含至少 4 种 event（subagent_dispatched / subagent_returned / tdd_red / tdd_green）——此条作为 R8 Initiative 开工的入门条件，不阻塞本 PR 合并
