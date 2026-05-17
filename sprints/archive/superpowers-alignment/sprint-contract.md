# Sprint Contract: Engine ↔ Superpowers 对齐固化

> Harness v4.3 格式
> Version: 1.0.0
> Created: 2026-04-18
> Branch: cp-04181830-r7-superpowers-gap
> Upstream PRD: `docs/PRD.md`
> Upstream DoD: `docs/DoD.md`

---

## 功能范围

### 本 Sprint 做什么

1. 新增 `packages/engine/contracts/superpowers-alignment.yaml` 契约文件，登记 14 个 Superpowers skill 的吸收状态（full / partial / not_planned）
2. 新增 8 个 Superpowers prompt 的本地化副本到 `packages/engine/skills/dev/prompts/` 并登记 sha256
3. 新增 3 个 DevGate 脚本（`check-superpowers-alignment.cjs` / `check-engine-hygiene.cjs` / `bump-version.sh`）及各自的单元测试
4. 扩充 `.github/workflows/engine-ci.yml`，新增 `engine-alignment-gate` job 调度这 3 个脚本
5. 同步 5 处版本号到 `14.17.5`（特别是 `.hook-core-version` 从 `13.7.7` 跳版）
6. 清理 Engine 仓库下 `manual:TODO` 占位符 + 悬空 `superpowers:` 外部引用
7. 在 `feature-registry.yml` 登记 `R7-superpowers-alignment` changelog 条目
8. 写 Learning：`docs/learnings/cp-04181830-superpowers-alignment.md`

### 本 Sprint 不做什么

- 不吸收 `using-git-worktrees` / `using-superpowers` / `writing-skills`（契约中明确 `not_planned`）
- 不修改 `~/.claude/skills/superpowers/` 源文件
- 不改 `01-spec.md` / `02-code.md` 流程主干（只在 `SKILL.md` 顶部加一条 `prompts/` 引用）
- 不引入"吸收率"数值指标（用契约覆盖清单替代）
- 不推送到 main，不启用 `--admin`，CI 必须 green 后常规合并

---

## Workstreams

Sprint 并行切分为 3 个 Workstream，对应上游 6 个 Agent（T1-T5）的预制件产出：

### WS1: 契约 + 本地化 prompt

**输入（上游预制件）**：
- T1 产出：8 个本地化 prompt 文件 + `manifest.yaml`
- T3 产出：`superpowers-alignment.yaml` 契约草案（14 skill）

**本 WS 动作**：
- 将 T1 的 prompt 文件落到 `packages/engine/skills/dev/prompts/<skill>/SKILL.md`
- 将 T3 的契约落到 `packages/engine/contracts/superpowers-alignment.yaml`
- 按本地副本实际内容重新计算 sha256，回填契约
- 校验 14 个 skill 的 `coverage_level` 分类完整（full + partial + not_planned 三态）

**DoD**：`contract-dod-ws1.md`

### WS2: DevGate 脚本 + 单元测试

**输入（上游预制件）**：
- T4 产出：3 个 DevGate 脚本草案

**本 WS 动作**：
- 将 T4 脚本落到 `packages/engine/scripts/devgate/` 与 `packages/engine/scripts/`
- 为每个脚本写单元测试（含 negative test：故意篡改后能拦截）
- `bump-version.sh` 支持 `--dry-run` 打印 5 处版本号 diff
- `check-engine-hygiene.cjs` 扫描：`manual:TODO` / 悬空 `superpowers:xxx/yyy.md` / 空 `regression-contract.yaml`
- `check-superpowers-alignment.cjs` 校验：契约合法性 + 本地副本 sha256 + required_keywords 存在

**DoD**：`contract-dod-ws2.md`

### WS3: CI + Hook 集成 + 违规修复

**输入（上游预制件）**：
- T2 产出：Engine 违规清单（精确到行号）
- T5 产出：`engine-ci.yml` / `.hook-core-version` / `feature-registry.yml` patch

**本 WS 动作**：
- 扩充 `.github/workflows/engine-ci.yml`，添加 `engine-alignment-gate` job
- 同步 5 处版本号至 `14.17.5`（跑 bump-version.sh 作为落地工具）
- 按 T2 清单逐条清理 `manual:TODO` 占位符和悬空 `superpowers:` 引用
- 确保 `regression-contract.yaml` 非空或标注 `allow_empty: true`
- 在 `feature-registry.yml` 加 changelog 条目 `R7-superpowers-alignment`
- 写 Learning 文件（`### 根本原因` + `### 下次预防` 两节）

**DoD**：`contract-dod-ws3.md`

---

## Workstream 依赖关系

```
WS1 (契约 + prompt)          WS2 (DevGate + 测试)
      |                              |
      |  产出: sha256 真实值           |  产出: 3 个脚本
      |                              |
      +--------+       +-------------+
               |       |
               v       v
         WS3 (CI + Hook + 违规修复)
                |
                v
           PR 提交 → CI green → Merge
```

- WS1 与 WS2 可**并行**（WS2 脚本的单元测试用 fixture，不依赖 WS1 真实契约）
- WS3 必须**晚于** WS1 + WS2（CI job 调用的就是 WS2 脚本，跑的对象是 WS1 契约）

---

## 验证命令（Evaluator 逐条执行）

Evaluator 按以下顺序执行，任一非零退出即 FAIL：

1. `bash packages/engine/scripts/check-version-sync.sh`
2. `node packages/engine/scripts/devgate/check-superpowers-alignment.cjs`
3. `node packages/engine/scripts/devgate/check-engine-hygiene.cjs`
4. `bash packages/engine/scripts/bump-version.sh patch --dry-run`
5. `test -f packages/engine/contracts/superpowers-alignment.yaml`
6. `node -e "const y=require('js-yaml');const c=y.load(require('fs').readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8'));if(c.skills.length!==14)process.exit(1)"`
7. `node -e "['brainstorming','writing-plans','executing-plans','subagent-driven-development','test-driven-development','verification-before-completion','systematic-debugging','receiving-code-review'].forEach(s=>require('fs').accessSync('packages/engine/skills/dev/prompts/'+s+'/SKILL.md'))"`
8. `node -e "const v=require('fs').readFileSync('packages/engine/.hook-core-version','utf8').trim();if(v!=='14.17.5')process.exit(1)"`
9. `node -e "const {execSync}=require('child_process');const r=execSync('grep -rn \"manual:TODO\" packages/engine || true').toString();if(r.trim())process.exit(1)"`
10. `node -e "const {execSync}=require('child_process');const r=execSync('grep -rnE \"superpowers:[a-z_-]+/[a-z_-]+\\\\.md\" packages/engine || true').toString();if(r.trim())process.exit(1)"`
11. `node -e "const c=require('fs').readFileSync('.github/workflows/engine-ci.yml','utf8');if(!c.includes('engine-alignment-gate'))process.exit(1)"`
12. `node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('R7-superpowers-alignment'))process.exit(1)"`
13. `npm test -- tests/engine/devgate/`
14. `node -e "const c=require('fs').readFileSync('docs/learnings/cp-04181830-superpowers-alignment.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`

---

## 通过标准

- 上述 14 条验证命令全部 exit 0
- CI `engine-alignment-gate` 在最后一次 push 上 green
- 中途曾在本 PR 内注入一条违规（sha256 故意改错）触发 CI 拦截，再回滚（负向证明 gate 有效）
- 下一个无关 PR 若改动 `prompts/` 某文件一个字节不同步 sha256，CI 能拦截（用 dry-run PR 验证即可，不合并）
