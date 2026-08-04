# 设计：刀0 — test-pyramid-guard 机械守卫 + 状态面板复活

> 来源：docs/prd/2026-07-14-ops-half-loop.prd.md 刀0节
> Brain task：596e6946 ｜ Sprint：sprints/07141040-test-pyramid-guard

## 目标

在刀1（测试自动入册）施工前，先让"测试金字塔的真实状态"变得机械可见、可拦截：
孤儿测试数、smoke 池跑道挂载、永久测试池计数，全部由脚本断言，红了 CI 拦。
顺带治好 2026-05-22 起停更的 CURRENT_STATE.md 僵尸健康横幅（根因=状态更新脚本（已退役）无调用方）。

## 现状事实（已核实）

- `sprints/**`（非 archive）现存 ~20 个 `*.test.*` + 5 个 `e2e-verify.sh`，07-10 大扫除后
  brain vitest 不再 include sprints，全部孤儿化。
- 根 `vitest.config.js` 的 sprints include 只服务 harness sprint PR 自己的 CI，merge 后无人再跑。
- smoke 池 `scripts/smoke/` 仅 2 条脚本。
- 状态更新脚本（已退役）存在、有 bash 测试，
  但**两者都没有任何调用方**——脚本停更、测试也是孤儿。
- ci.yml 已有 `lint-*` 型 job 直接 `bash .github/workflows/scripts/__tests__/xxx.test.sh` 的先例。
- 本机 crontab 已有 janitor daily（4am）先例，本地日更走 cron 与现状一致。

## 组件设计

### 1. `scripts/test-pyramid-guard.mjs`（核心，纯 Node 无依赖）

四断言，任一红 → 非零退出码：

| # | 断言 | 判据 | 红的含义 |
|---|---|---|---|
| A1 | 孤儿棘轮 | `sprints/**`（排 archive）`*.test.*` + `e2e-verify.sh` 计数 ≤ baseline.orphans | 有人新增了不入册的 sprint 测试 |
| A2 | smoke 挂跑道 | `scripts/smoke/*.sh` 每条在 `.github/workflows/**` 或 `scripts/*deploy*` 中被引用 | smoke 脚本成了没人跑的摆设 |
| A3 | 永久池棘轮 | baseline.permanent_roots 下测试文件计数 ≥ baseline.permanent | 有人摘 include / 删测试没走显式退役 |
| A4 | 面板活性（仅本地模式）| `.agent-knowledge/CURRENT_STATE.md` 的 generated 时间 < 48h | 面板又僵尸了 |

- A4 在 CI（`CI=true`）跳过：repo 里的 CURRENT_STATE 副本不随本地日更 commit（避免每日 main 提交噪音），
  活性只对本地主仓有意义（会话横幅读的是本地文件）。
- `--json`：输出 `{orphans, smoke:{total,unwired}, permanent, layers:{unit,integration,e2e}, pass}` 供面板/巡检消费。
- 棘轮方向：A1 实测低于 baseline 时提示（不强制）下调 baseline；A3 退役需显式改 baseline 并在 commit message 说明。

### 2. `scripts/test-pyramid-baseline.json`

```json
{ "orphans": <当前实测值>, "permanent": <当前实测值>,
  "permanent_roots": ["packages/brain/src/__tests__", "packages/brain/tests",
                      "tests", "packages/engine/tests", "packages/quality"] }
```

基线即账本：刀1 入册一批，orphans 基线降一格，直到 0。

### 3. 自测（防"守卫自己成孤儿"）

`scripts/__tests__/test-pyramid-guard.test.sh`：bash harness，在 tmp 造 fixture 仓
（含超基线孤儿 / 未挂跑道 smoke / 少于基线的永久池），断言 guard 对每种情况**真报红**、
对干净 fixture 报绿。测试与真跑同 job 执行 → 每次 CI 都 proven-to-fire，不存在"放哪才会被跑"的问题。

### 4. CI 接线

- ci.yml 新增 job `test-pyramid-guard`（无条件跑，秒级）：先 `bash 自测` 再 `node guard`。
- nightly-regression.yml（刀A）加同样一步（每日兜底 + 失败随刀A现有机制开 Issue）。

### 5. 面板复活

- 状态更新脚本（已退役）增「测试金字塔」段：调 `guard --json` 写入三层计数/孤儿数/最后运行时间。
- 顺手把孤儿测试接进 guard 同一个 CI job。
- 调用方（merge 后机器态操作，不进本 PR diff）：本机 crontab 加每日一条
  （与 janitor 同机制）。A4 保证这条线断了会被看见。

## 不做（本 PR）

- Dashboard（apps/dashboard）金字塔页面 → 刀0 后续增量另立任务
- 测试自动搬运/入册 → 刀1
- FR 守卫槽位 / dead man's switch → 刀3

## 测试策略

- **unit/自测**：bash fixture harness（上文 §3），覆盖四断言各自的红/绿两态
- **integration**：guard 对真实仓库跑一次必须绿（基线=实测值起步）
- **E2E/proven-to-fire**：CI job 里自测先行，每次 PR 都亲眼看 fixture 版 guard 报红
- **trivial**：baseline JSON 格式由 guard 启动时校验

## 错误处理

- baseline 文件缺失/损坏 → guard 红（缺账本=不可验，宁红勿绿）
- sprints/ 目录不存在 → orphans=0（干净仓合法）
- guard 自身异常 → 非零退出（CI 红），不吞错
