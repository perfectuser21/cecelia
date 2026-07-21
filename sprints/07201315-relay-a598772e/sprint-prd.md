# Sprint PRD — harness relay 收编 grok executor——三厂商走量格局落地

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 端到端贯通验证（journey bb8cc561）
- **当前进度**：executor=claude / codex 两路已验收并在生产稳定跑；grok 已在 dispatch-worker.mjs 工人池中（ACCOUNT_POOL 第4号），但 harness-skill-relay 主路由尚未接入
- **本次推进预期**：让 `executor=grok` 的 harness_initiative 任务能被 skill-relay 接收、spawn grok 二进制、走完 planner-GAN-generator-evaluator 全链产出 PR 并 merge；三厂商格局正式落地

## 背景

`harness-skill-relay.js` 当前在 L101 通过 `isCodex = task.payload?.executor === 'codex'` 做二路分叉（codex 路径/默认 claude 路径）。`dispatch-worker.mjs` 已在 L36-38 验证了 grok 调用格式（`~/.grok/bin/grok -p <brief> --cwd <dir> --always-approve`），ACCOUNT_POOL 中也已有 grok 账号条目（L18-19）。

本次任务目标是把 grok 收编为 harness-skill-relay 的正式 executor，对 codex 先例 1:1 照抄实现路径，不改动 claude/codex 既有行为。

约束来源：PrepPRD thin_prd 字段（task a598772e payload.thin_prd）。

## Golden Path（核心场景）

用户注册 executor=grok 的最小 harness 任务 → Brain dispatch → relay spawn grok 容器 → grok 二进制跑完 planner-GAN-generator-evaluator 全链 → 产出 PR 并 merge

具体：
1. Brain 创建 `task_type=harness_initiative, payload.executor=grok, payload.orchestrator=skill-relay` 任务
2. dispatcher claim 任务 → `spawnSkillRelaySession` 识别 `isGrok=true`
3. 容器内挂载 `~/.grok`（含 `auth.json`，由 `GROK_RELAY_HOME` env 指定），启动命令：`~/.grok/bin/grok -p <prompt> --cwd <worktree> --always-approve`
4. harness-controller skill 全链跑完（planner→GAN→generator→evaluator）
5. PR 由 controller 发起 + merge；grok 容器日志可证明是 grok 二进制在跑
6. 若 grok 输出触发 `QUOTA_WALL_PATTERNS`（out of credits / rate limit / 429 / quota exceeded），任务降级到 claude executor 重试一次

## 边界情况

- `GROK_RELAY_HOME` 配置为空字符串 → loud-fail，task 回滚到 queued，不静默降级（对齐 CODEX_RELAY_HOME 先例 L141-152）
- `GROK_RELAY_HOME` 未设置（undefined）→ 允许继续（测试注入 spawnFn 覆盖，与 codex 先例对称）
- grok auth.json 不存在 → spawn 后 grok 二进制自行报错，容器日志可见，不是 relay 层责任
- headed 模式 + executor=grok → headed 分支同样需接入 grok（L471 入口白名单同步更新）
- 额度撞墙识别：grok 无用量 API，用 `dispatch-worker.mjs` 的 `QUOTA_WALL_PATTERNS` 文本匹配识别（出现 out of credits / rate limit / 429 / quota exceeded/reached/limit）
- fallback：撞墙后降级到 claude executor 重试一次，非撞墙失败不换 executor（任务问题 vs 额度问题区分对齐 dispatch-worker.mjs L55-57）
- runner 镜像若需预装 grok 二进制 → 按 relay-codex-executor 先例处理，PR 说明镜像 rebuild 步骤
- 去重守卫：`docker ps -q --filter "name=cecelia-relay-${short}"` 已有容器时提前返回（继承 L110-124 headless 守卫 + L521-541 headed tmux 守卫）

## 范围限定

**在范围内**：
- `packages/brain/src/harness-skill-relay.js`：
  - L101 起新增 `isGrok = task.payload?.executor === 'grok'` 分支
  - `GROK_RELAY_HOME` env 检查（对齐 L138-152 CODEX_RELAY_HOME 逻辑）
  - headless spawn：extraMounts 加 `${grokRelayHome}:/home/cecelia/.grok:rw`，启动命令 `~/.grok/bin/grok -p <prompt> --cwd <dir> --always-approve`
  - L471 `_spawnHeadedSession` 入口白名单：`'codex' : 'grok'` 同步加入（headed 分支 headedExecutor 映射）
  - `HEADED_HOSTS` / `HEADED_TMUX_PREFIXES` 加 grok 条目
  - initiative_runs 落行 orchestrator_host='skill-relay-grok'（与 skill-relay-codex 区分）
  - 额度撞墙检测 + fallback 到 claude 重试逻辑
- `packages/brain/src/__tests__/harness-skill-relay.test.js`（或新建同目录测试文件）：
  - grok headless spawn 单测（fake spawnFn 注入）
  - `GROK_RELAY_HOME=''` loud-fail 单测
  - `GROK_RELAY_HOME` 未配置（undefined）放行单测
  - 撞墙 fallback 路径单测（detectQuotaWall 输出触发 → executor 降级 → claude 重试）
  - 回归测试：isCodex/claude 既有路径不变（本 sprint commit 后全量 relay 测试必须绿）
- `sprints/07201315-relay-a598772e/e2e-verify.sh`：Final E2E 脚本（验收用）

**不在范围内**：
- 不改 dispatch-worker.mjs（grok 工人已在 ACCOUNT_POOL，本次只接 relay 层）
- 不改 migrations（不新增 executor 枚举 DB 字段，字符串直接存 payload）
- 不改 dashboard/UI
- 不改 packages/quality/smoke-allowlist.txt 以外的 CI 文件（共享文件默认禁区）
- 不做多账号 grok 轮换（单账号 ~/.grok，与当前 codex team2 先例等级对齐）

## 假设

- [ASSUMPTION: `~/.grok/bin/grok` 在容器内通过挂载 GROK_RELAY_HOME 可达，二进制权限已设 700+]
- [ASSUMPTION: `auth.json` 在 `~/.grok/` 下，grok 二进制读取 auth 方式与 dispatch-worker.mjs L65-68 `existsSync(join(account.home, 'auth.json'))` 一致]
- [ASSUMPTION: grok CLI `-p <brief> --cwd <dir> --always-approve` 为合法调用签名，已在 dispatch-worker.mjs:37 生产环境验证]
- [ASSUMPTION: runner Docker 镜像不预装 grok 二进制——通过挂载宿主 ~/.grok/bin/grok 解决，无需镜像 rebuild；若实际需要 rebuild，PR 说明中注明步骤]
- [ASSUMPTION: grok 无并发限制需求（codex 有 _activeCodexRelays 守门），grok 路径不引入进程内并发守门，除非测试证明需要]

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`：主改动（isGrok 分支、GROK_RELAY_HOME 检查、headless/headed spawn、额度撞墙+fallback、HEADED_HOSTS/TMUX_PREFIXES 扩展）
- `packages/brain/src/__tests__/harness-skill-relay.test.js`：新增/扩展测试（grok spawn、GROK_RELAY_HOME loud-fail、撞墙 fallback、回归 isCodex/claude 不变）
- `sprints/07201315-relay-a598772e/e2e-verify.sh`：Final E2E 脚本

## E2E 验收

Final E2E 验收点（`target_environment=local_api`，验收脚本 `sprints/07201315-relay-a598772e/e2e-verify.sh`）：

1. **grok 二进制实跑**：注册 `executor=grok` harness_initiative 任务，Brain dispatch 后 docker logs 含 grok 二进制启动证据（如 `grok` 进程名或 grok 特有输出模式）
2. **全链完成**：`GET /api/brain/tasks/{task_id}` status='completed'，`initiative_runs` 有该 initiative_id 记录，phase 最终到达 done
3. **PR 产出**：relay 全链跑完产出 PR 并 merge（PR URL 可在 task result 或 initiative_runs 中查到）
4. **容器挂载验证**：容器启动参数含 `GROK_RELAY_HOME` 挂载 mount（docker inspect 可见 `/home/cecelia/.grok`）
5. **撞墙 fallback 单测**：`detectQuotaWall("out of credits")` 返回 true，grok spawn 撞墙后 executor 降级到 claude 重试，有独立单测覆盖且 CI 绿
6. **回归**：`packages/brain/src/__tests__/harness-skill-relay.test.js` 全量通过（isCodex / claude 既有路径无任何变化）

```bash
# e2e-verify.sh 结构占位（proposer 按 local_api 填入真实脚本）：
# 1. curl localhost:5221/api/brain/tasks/{TASK_ID} → 校验 status=completed
# 2. psql cecelia -c "SELECT phase FROM initiative_runs WHERE initiative_id='{TASK_ID}'" → done
# 3. docker logs cecelia-relay-{SHORT} 2>&1 | grep -E "grok" → PASS/FAIL
# 4. docker inspect cecelia-relay-{SHORT} | jq '.[].HostConfig.Binds' | grep .grok → PASS/FAIL
# 5. npm test -- --grep "grok.*quota.*fallback" → PASS/FAIL
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（6条，body 字段为空，以 area learning 补充）+ area learning（参考历史 sprint PRD 同源）-->
- [多设备类型(os_type/device] contract-dod 模板加规则：新字段与既有字段语义重叠时必须本 sprint 内消解或建正式 decision+挂任务队列，禁止只在文档里写"留给后续技术债 sprint"了事（来源: area, id=8dbe91ee）
- [capture-triage] learning: 新增 task_type / executor 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / smoke-allowlist 登记 / 回归测试保护（来源: area, id=5b91a042）
- [capture-triage] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享文件）不得在本 sprint 随意修改（来源: area, id=1100cb8f）
- [capture-triage] learning: feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area, id=3efefc23）
- [capture-triage] learning: 依赖真机/生产 env/真实调用方的接缝断言必须在真目标上验证过才算 done；未真验的只能标 logic-done-pending，绝不标 done（来源: area, id=3c30394c）
- [capture-triage] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致（来源: area, id=26886b60）
- [smoke-invariant-1783] smoke 铁律（来源: area, id=552520d0）
- [系统] 屏幕外坐标/UIA 气泡阈值/假设调用方传 X/假设 .env 有 Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area, id=5e125909）
- [系统] secrets 不硬编码、不进 git、不进日志（GROK auth.json 走挂载，不写死路径，不打印到容器日志）（来源: area, id=564802ee）
- [grok-relay 铁律] `isGrok` 分支改动不得触碰 isCodex/claude 分支的任何判断逻辑和变量（回归保护）；任何对 `_activeCodexRelays`、`codexRelayHome`、`isCodex` 的引用不得被 grok 路径重用或覆盖
- [grok-relay 铁律] `GROK_RELAY_HOME=''`（显式空）必须 loud-fail + task 回滚；`GROK_RELAY_HOME` 未配置（undefined）必须放行（与 CODEX_RELAY_HOME L141-152 先例对称，不得倒置）
- [grok-relay 铁律] 额度撞墙降级 fallback 路径必须有独立单测覆盖（`detectQuotaWall` + executor 切换 + claude 重试的完整链路）；撞墙 fallback 不得影响 claude/codex 既有路径
- [grok-relay 铁律] grok 容器日志必须能证明是 grok 二进制在跑（Final E2E 硬断言，不接受"能 spawn 但不确认是否 grok 在跑"）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey bb8cc561 golden-paths 查询为空数组（journey maturity=skeleton，尚无已验收 ability）-->
- executor=claude relay 全链（headless + headed）已验收（a85e0582 / 4bb31ef5 / 57e25e92 先例）
- executor=codex relay 全链（headless）已验收（07b2fd3b / 85806b9a 先例）
- dispatch-worker.mjs grok 工人调用格式 `grok -p <brief> --cwd <dir> --always-approve` 已生产环境验证（L37 注释 "已验证的调用式"）
- QUOTA_WALL_PATTERNS 文本识别逻辑已在 dispatch-worker.mjs 验收（5 个 pattern：out of credits / rate limit / usage limit / 429 / quota exceeded|reached|limit）

## NFR 约束

<!-- 来源: PrepPRD thin_prd 无显式 NFR；decisions category=nfr 1条（body 为空）；golden-path-decisions?category=nfr 查询为空数组 -->
- 超时/延迟：grok relay deadline 对齐 CODEX_RELAY_DEADLINE_HOURS=8h（grok 任务预期与 codex 同量级）
- 并发：初版不引入 _activeGrokRelays 进程内守门（无历史数据支撑限制值），若生产出现并发问题由 watchdog 处理
- 凭据：GROK_RELAY_HOME 指向宿主 ~/.grok，auth.json 600 权限，不进 git、不进日志
- 可观测：docker logs 可见 grok 二进制启动；initiative_runs orchestrator_host='skill-relay-grok' 区分可查；撞墙 fallback 有 console.warn 日志
- 回归：本 sprint 不得改动 claude / codex relay 任何既有行为，全量 harness-skill-relay 测试必须绿

## journey_type: autonomous
## journey_type_reason: 纯 Brain/harness 后端 relay 路由改造，无用户可见 UI 交互（与 codex/claude executor 接入先例同类）
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221、Docker 容器日志、本地 PostgreSQL 查询，无需浏览器或远端 runner
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定具体 step）
