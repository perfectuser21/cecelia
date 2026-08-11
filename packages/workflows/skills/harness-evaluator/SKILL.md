---
id: harness-evaluator-skill
description: |
  Harness Evaluator — 阶段 B **pre-merge gate**（不是 merge 后）：
  Generator 写完代码 push PR 后，CI 跑过基础卫生（lint/type/vitest mock/build），
  evaluator 在 CI 绿之后、PR merge 之前真启服务 + 跑 contract 的 manual:bash 命令验真行为。
  PASS → 允许 merge；FAIL → 不 merge，带反馈打回 Generator 在 PR 分支 fix loop（main 不变动）。
  单模式（harness v2 始终 IS_FINAL_E2E=true）：读 contract-draft.md 的 ## E2E 验收 脚本，按 target_environment 派发跑 Golden Path 端到端真实行为。
version: 1.35.2
created: 2026-05-06
updated: 2026-08-11
changelog:
  - 1.35.2: 精确 PR 验收证据桥——TaskBundle inputs 含 `required_command_evidence` 时逐条原样执行，任何失败都判 FAIL；每条命令必须以逐字一致的 command、真实 exit_code 与非空 log_tail 单独进入 checks，供 Judge 机械逐项对账，禁止只在 summary 声称已执行
  - 1.35.1: Kernel 只读结果通道——最终 verdict 优先写 Runner 注入的 `BRAIN_RESULT_FILE`，未注入才回退工作树 `.brain-result.json`；仓库读取/E2E 仍使用 WORKSPACE，Reviewer/Evaluator 无需为结构化结果放宽只读挂载
  - 1.35.0: Kernel A 可信胶囊加固——GitHub artifact 由 Provider 前可信阶段按成员数/单文件/总量/压缩比限额流式解包，跨目录、symlink、重复成员、加密包与 ZIP bomb 全部 fail-closed；manifest 为每个 `extracted_files` 绑定 SHA-256，root 封存后 Evaluator 只读现成证据，不再自行解包到可写 `/tmp`
  - 1.34.0: Kernel A 安全边界——Evaluator 不再触发、轮询或下载 GitHub Actions；US M4 可信取证前置按 repo/PR/exact head/workflow/run/artifact 生成哈希证据胶囊并销毁凭据，Evaluator 只消费 `HARNESS_EVIDENCE_CAPSULE_DIR`，本地 HEAD 或 manifest 身份不一致直接 FAIL
  - 1.33.0: W7 人形验收（RD 2026-07-28，决策 d3021871，与 proposer 9.17.0 配套）——L1 按步执行逐步留证（每条剧本：执行动作 → within 等待预算轮询预期观察 → 采集留证（截图/命令输出/DB结果）→ 跑 Test: 单行命令；behavior_tests 条目新增 wait_budget/evidence 字段）；L2 意外观察（执行中发现卡顿/报错/布局歪/慢响应必录 verdict 顶层 findings[] additive 字段 + SPRINT_DIR/findings.md，P0/P1 即使断言全绿也 FAIL）；L3 探索层（剧本全过后按合同 ## 探索提示 段自由测试，默认 10 分钟/15 动作，legacy 合同无此段则跳过）；[接缝×2] 步骤重复执行 2 次不一致 → FAIL 且 failed_step="FLAKY:<步骤名>"；SEGMENT_EVAL 段验与 [legacy] 条目按旧协议不变
  - 1.32.2: attempt evidence fail-closed 补全——所有最终 PASS/FAIL verdict（含 dispatch/setup、环境/URL/workflow、timeout 与示例模板）都显式写当前 `HARNESS_ATTEMPT_ID`，避免早退失败证据因缺 attempt_id 被 runner 拒收后空转
  - 1.32.1: cross-repo bundled runtime——默认非 Windows Step B-1 用 quoted here-doc 随 Skill 内容落地自包含 extractor，不再依赖目标仓库存在 Cecelia `scripts/`；内嵌资产与 canonical extractor 逐字节契约锁定
  - 1.32.0: 默认非 Windows Step B-1 改走仓库共享 `extract-contract-e2e.cjs`，与 evaluator/过渡登记共用唯一 parser；H2+ E2E 标题、多段歧义、空证据及多 bash block 顺序语义不再由 Skill 内 AWK 自建第二口径
  - 1.31.0: kernel evidence 绑定 attempt——注入 `HARNESS_ATTEMPT_ID` 时，`.brain-result.json` 顶层必须原样写入 `attempt_id`；runner 只桥接 task_id 与 attempt_id 均精确匹配的结构化 behavior_tests，禁止 checkout/reset 恢复的旧证据冒充当前 evaluator 结果
  - 1.30.0: evaluator 角色隔离——Step B-1 只把合同 E2E 提取到 /tmp 并执行，禁止 commit/push 或改写 PR；永久回归脚本由 Generator 在 evaluator 前入库，缺失或 CI 不接受时由 verdict/fix loop 反馈 Generator。配套 kernel launcher 用 remote.origin.pushurl 环境 fence 阻断 evaluator 远端 Git 写入，保留可写 worktree 供真实 package manager/E2E 使用
  - 1.29.0: MJ5 S3 联动清单（thin档，additive）——Step B-1.4 改用 payload.feature_id + GET /features/:id/blast-radius；评估可跑断言（tests/|manual:）并直接 PATCH cell_status=green；cascade_assertions 数组写入 verdict JSON 供 Brain execution.js Step 3.6 幂等备份；feature_id 缺失时跳过不 block（thin档不强制全跑）
  - 1.28.0: target_environment 加 android_realmachine 路由分支（洞①）— TARGET_ENV 表 + case 并入 windows_cloud|windows_wechat 桶 + ANDROID_REALMACHINE_WORKFLOW 变量
  - 1.27.0: gear 档位：「Relay 入口段」新增 SEGMENT_EVAL=<task_id> 段级轻验收（移植自 cecelia #4027 harness-gear 一体化 60a80ddc 决策5）——跳过 final-E2E，只跑该段 [BEHAVIOR]/tests 断言 + 复跑此前所有已绿段测试（回归棘轮：已绿变红 → 本段 FAIL 且失败摘要注明回归项）；verdict 输出格式不变，额外带 segment_eval 字段；default（未出现 SEGMENT_EVAL）保持全量模式原文行为不变
  - 1.26.0: 配套三段式剧本格式——evaluator 按剧本逐步执行：先执行「动作」，再 within 预算轮询「预期观察」，最后跑「验证命令」；behavior_tests 条目支持 action/expected 新字段（与 command/exit_code/log_tail 共存）
  - 1.25.0: verdict 输出带 verification_level 字段（决策145014a4 W3）——.brain-result.json 顶层新增 verification_level 字段（缺省 L2），behavior_tests 条目新增 verification_level 字段；与 W2 judge #4004 解析约定对齐（behavior_tests[i].verification_level = 'L1'|'L2'|'L3'，brainResult.verification_level = 'L1'|'L2'|'L3'）
  - 1.24.0: 新增 Step B-1.8b 禁 mock 边机械核查（刀2，配套 proposer 9.12.0/generator 7.10.0）——读合同 ## 禁 mock 边清单 → grep 本单测试文件的 vi.mock/jest.mock/stub 目标 → 命中清单内的边 → CONTRACT-IS-LAW FAIL（feedback 含证据文件+行号）；清单缺失但本单涉及调度/状态机/跨模块传递/生命周期钩子/DB写路径 → FAIL 归责 GAN；#3830/#3848/#3808/#3840 实证接缝层 bug 全 mock 单测结构性抓不到
  - 1.23.0: EVA v2 审计四修——(E1) verdict 必带真跑证据：behavior_tests 每条必须是对象 {command, exit_code, log_tail}（log_tail=命令输出末 5 行），缺任一 = 该条视为未跑禁 PASS（a85e0582 实证 verdict 只列命令原文无法区分真跑/声称跑过）；(E4) Step B-1 固化段加分支判断：detached HEAD（post-merge 补验模式）跳过 commit/push 并在 verdict notes 说明，普通路径 push 失败输出 WARN 记入 notes（删静默吞掉）；(E5) 三处 awk 标题正则放宽为 /^##+[[:space:]]*E2E[[:space:]]*验收/（### 或带空格变体不再整段漏空）；(E7) 注入变量表补 PR_BRANCH 行
  - 1.22.0: a638f840 三修——(a) Step 0a 支持"PR 已 merge/分支已删"场景：checkout 失败时查 gh pr state，MERGED 则在 merge commit/origin/main 上补验（post-merge 模式），仅 PR 非 MERGED 时才 FATAL；(b) Step B-1 三处 awk 改为提取 E2E 段内全部代码块（拼接至下一个 ## 标题，旧版只取第一块，多块合同 Step 2-9 被静默丢弃）；(c) bash 固化前加 bash -n 语法门，语法坏脚本在 setup 就 FAIL 不入库
  - 1.21.0: 跨 repo 化刀3——①变量表 DB 行改为优先 $DB_URL（payload/env 注入），postgresql://localhost/cecelia 仅作 cecelia 本机 fallback；②url_validation gate 按 repo 注入：cecelia 默认仍 grep localhost:5221|psql cecelia，第三方 repo 以 $EXPECTED_API_HOST/$DB_URL 为准，两者都未提供时对第三方 repo 降级 WARN 而非 FAIL（避免假 FAIL）；③windows 分支与 Step B-2.6 的 REPO 不再写死默认仓库：fallback 顺序 $GITHUB_REPO → payload.base_repo URL 解析 owner/repo → 两者都缺才回退旧默认并打 WARN
  - 1.20.0: EVA 提分（GAPS #2）——新增「Relay 入口协议」（对称 T5 出口段）：controller 用 Task 派发时从 prompt 参数取 SPRINT_DIR/PR_BRANCH/TARGET_ENV/合同路径，env 与 prompt 参数二选一均可启动，Step 0 FATAL 仅限 v1 env 路径；反作弊红线显式接回 relay 路径（E2E 段缺失/[BEHAVIOR] manual:bash 从未真跑 → 必 FAIL，禁拿 vitest 结果冒充 Golden Path 验收）；WORKSPACE 解析补宿主 fallback（/workspace 不存在时落 $PWD）。additive，双门/SHA锚定/verdict JSON 语义不变
  - 1.19.0: 追加「Relay 出口 + CANNOT_VERIFY 第三态」（T5，additive）——无法验证的断言进 unverifiable[] 交 controller 兜底，禁止臆断 FAIL（治误判 FAIL→无限 fix loop 谱系）；verdict JSON 结构不变（v1 双轨兼容）
  - 1.18.0: Slice3 固化 — bash/mac_web/local_api 分支补 cp+git add e2e-verify.sh 进 sprint 目录（镜像 windows 分支），让 bash golden-path E2E 脚本随 PR 永久入库、merge 后进回归套件重跑（堵"脚本只活 /tmp 跑一次蒸发"的地基洞主洞）
  - 1.17.0: 新增 Step B-1.9 Machine Probe — windows_cloud/wechat 环境执行前检测 E2E 脚本硬编码绝对路径（/Users/ /home/ C:\Users\），发现即 FAIL；成功后输出标准化环境变量（CHROME_PATH/WECHAT_DATA/NODE_VERSION）供 E2E 脚本 source 替代硬编码路径
  - 1.16.0: 删除 Step B-1.7 弱 oracle/作弊扫描（机械逻辑下沉 Contract Gate 代码层，践行"机械判定归代码、skill 留语义判断"原则）
  - 1.15.0: 链路审计修复 7 项 — (a) 清理模式 A/WS 拆分残留（description/常见错误/变量表统一为单模式 IS_FINAL_E2E=true 跑 contract-draft.md ## E2E 验收，全文清掉 ws_id/contract-dod-ws）；(b) 修 Step B-2 双重执行 bug（删无条件首跑，windows 环境不再 bash 不存在的 .sh，超时 124 判定并入 case 后统一）；(c) 新增 Step B-1.6 环境预检 + localhost 重写（容器内 sed 重写 + 二进制 command -v 缺失即 env_missing FAIL，禁止降级）；(d) 新增 Step B-1.7 弱 oracle/作弊扫描；(e) 新增 Step B-1.8 Golden Path 覆盖核对；(f) 新增「领域验证死规则」（视频 ffprobe / 发布真实出现 / DB 时间窗 / UI 可见断言）；(g) 修注入变量表 WECHAT_RPA_WORKFLOW/WORKSPACE_PATH/mac_web 注解
  - 1.14.0: windows_wechat E2E 路由 3 项修复 — P0: 删除 ;;&fallthrough，windows_wechat 合并入 OR pattern 触发 e2e-wechat-rpa.yml（xian-rog self-hosted）；P1: Step B-1 ps1 提取条件加入 windows_wechat；P2: B33 autonomous 检测排除 windows_cloud/windows_wechat（PowerShell E2E 不含 localhost:5221 是正常的）
  - 1.13.0: 截图路径从 ~/claude-output/ 改为 SPRINT_DIR/screenshots/（与 Report Step8 index.html 对齐）
  - 1.12.0: 修复历史 DoD 文件名 + 变量名双重不匹配 — proposer v8.0 起统一写 contract-dod.md（取代旧 per-WS 拆分文件名）；统一解析变量名（历史条目，单模式后已不再有多文件 fallback）
  - 1.11.1: 修复空壳检测正则漏掉 npm test/npm ci 和 PowerShell 业务命令 — eval 中发现 BUSINESS_STEPS 正则用 "npm run" 但未含 "npm test"（GHA 常用写法）及 "npm ci"，导致用了 npm test 的真实业务 workflow 被误判为空壳；同步补充 PowerShell 业务模式（Set-Content/New-Item/ConvertTo-Json）防止 PS 脚本的 session 写入被漏判
  - 1.11.0: windows_cloud 模式 B trigger 前新增 workflow 内容检查 — 在 gh workflow run 之前检查：(1) workflow 文件是否存在；(2) 合同 contract-dod.md 是否有 [BEHAVIOR] 条目；(3) workflow 是否只有文件存在/大小检查而不含业务逻辑验证（node/npx/vitest/playwright/curl 等）。第 3 条命中时直接 FAIL，防止 workflow 空壳导致假绿
  - 1.10.0: mac_web host executor 兼容 — 新增 WORKSPACE="${WORKSPACE_PATH:-/workspace}" 变量；所有 .brain-result.json 写入路径改为 "$WORKSPACE/.brain-result.json"（Docker /workspace，宿主 worktreePath）；mac_web Step B-2 修复：由 node /tmp/e2e-verify.js（文件不存在）改为优先 bash /tmp/e2e-verify.sh 并 fallback node .js；更新注入变量表格添加 WORKSPACE_PATH 和 WINDOWS_CLOUD_WORKFLOW
  - 1.9.0: Step B-2.5 截图处理（mac_web 专属）— 复制 screenshots/*.png 到 sprint 截图目录（v1.13 后统一 SPRINT_DIR/screenshots/）；Claude Read 每张 PNG 视觉自验（对照 BEHAVIOR:E2E 期望描述）；生成公网 URL（38.23.47.81:9998）；PASS brain-result.json 增加 screenshots 字段
  - 1.8.0: 删除 windows_local case — 所有 Windows 测试统一走 windows_cloud（GitHub Actions），无需维护 xian-pc/xian-rog 本地 Windows 机器；TARGET_ENV 枚举同步缩减
  - 1.7.0: windows_native 拆分为 windows_cloud + windows_local（已被 1.8.0 合并）
  - 1.6.0: 修复 B33 误伤真实功能 sprint — B33 URL 检测改为 playground 感知：playground sprint（playground/server.js 存在）禁止出现 Brain API URL；真实功能 sprint（autonomous journey_type）反向要求 E2E 脚本必须含 Brain API URL，缺失直接 FAIL（防止 playground 命令混入真实 sprint）
  - 1.5.0: Rule 4 弱 oracle 改 FAIL — 命令缺 jq -e 值校验不再"容忍但报告"，直接输出 FAIL feedback 拒绝通过；中间态在 GAN 已收敛后无意义（proposer v7.8 配套）
  - 1.4.0: B33 e2e URL 位置词检测 — W35/W43 实证 planner 在 playground sprint 的 e2e 生成了 /api/brain/ping 而非 playground /ping (localhost:3000)。Step B-1.5 加 pre-exec 扫描，含 /api/brain/ 的命令立即 FAIL 并标 planner_drift
  - 1.3.0: 明确 pre-merge gate 位置（反 2026-04-09 决策）— description 重写 + 加 "## 调用时机" 段，说明 evaluator 跑在 CI 绿后、PR merge 前。配套 brain 编排改动（harness-initiative.graph.js 把 evaluate 从 merge 后挪到 merge 前）由独立 PR 跟进
  - 1.2.0: 修协议盲 — 加 Test: 字段 manual:bash/manual: 前缀处理段（proposer SKILL v7.4+ 写此格式，evaluator 必须 strip 后执行）
  - 1.1.0: 加反作弊 reflexive check — 禁止把 vitest "passed" 当 PASS 替代物（W19/W20 实证 sub-evaluator 漏判 schema drift 的根因）。强制每条 [BEHAVIOR] Test: 命令必须真执行；命令缺 jq -e 或自然语言期望直接 FAIL；vitest 输出存在但合同 [BEHAVIOR] 未真跑 → FAIL。对齐 Anthropic harness-design "evaluator 默认会过度通过，必须 prompt 工程严格化"
  - 1.0.0: 初版 — Step A 模式 (DoD 验证) + Step B 模式 (E2E)，按 journey_type 选验证工具
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，直接按本文档流程操作。**

# /harness-evaluator — Harness Evaluator（阶段 B · 验证层）

## 调用时机（v1.3 — pre-merge gate）

```
generator 写代码 + push PR
       ↓
   CI 跑（cheap layer）— lint/type/vitest mock/build/secrets
       ↓ CI 绿
   ★ evaluator 跑（expensive layer）— 真启 server + curl + jq -e   ← 这就是我
       ↓ evaluator PASS
   PR auto-merge（branch protection 卡 evaluator status check）
       ↓
   final_evaluate 跑 Golden Path 端到端
```

**关键 invariant**：evaluator 不 PASS，main 不变动。

**为什么 pre-merge 而非 post-merge**：
- post-merge 跑 → FAIL 时 main 已污染，fix loop 在污染的 main 上跑（违反"评判从执行分离"）
- pre-merge 跑 → FAIL 不 merge，fix loop 在 PR 分支，main 永远干净

**为什么 CI + evaluator 双层不可省**：
- CI（vitest mock）验"代码层正确"，秒级零成本
- evaluator（manual:bash）验"启动 server 真发请求看响应"，1-2min + ~$0.5
- 两层验不同事，不可替代
- memory 实证：CI 全绿但真启动 SyntaxError / host.docker.internal 不解析 / migration 漏跑 → 这些只 evaluator 抓

---

**角色**: Evaluator（真实验证器）
**对应 task_type**: `harness_evaluate`

---

## 注入变量（由 cecelia-run 通过 prompt 注入）

| 变量 | 含义 |
|------|------|
| `IS_FINAL_E2E` | harness v2 始终注入 `true`（单模式 E2E）；v1 env 路径下缺失或非 `true` = Brain dispatch 异常，直接 FATAL（见 Step 0）；**relay prompt 派发时必然缺失，视为 `true`，不 FATAL**（见「Relay 入口协议」） |
| `SPRINT_DIR` | Sprint 目录，如 `sprints/run-20260506-1400` |
| `TASK_ID` | Brain 中当前 evaluate task 的 UUID |
| `HARNESS_ATTEMPT_ID` | kernel 当前 evaluator attempt 的 UUID；注入时 verdict JSON 顶层 `attempt_id` 必须逐字一致，禁止沿用旧 attempt 证据 |
| `HARNESS_EVIDENCE_CAPSULE_DIR` | Kernel 可信取证前置生成的只读/验后复核目录；远端 Windows/Android 验收必须读取其中 `github-evidence-capsule/v1` manifest 与 artifact，Evaluator 无 GitHub 凭据 |
| `PR_BRANCH` | 待验证 PR 分支名——Brain evaluateContractNode 注入 / relay prompt 提供（Step 0a 消费）（EVA v2 E7 补） |
| `JOURNEY_TYPE` | `user_facing` / `autonomous` / `dev_pipeline` / `agent_remote` |
| `TARGET_ENV` | `mac_web` / `windows_cloud` / `windows_wechat` / `linux_server` / `local_api` / `playground` / `android_realmachine`（来自 PRD `target_environment` 字段；`mac_web` = 在宿主 Mac 直跑（非 Docker），Playwright 可达 localhost:5174；`windows_wechat` = xian-rog self-hosted，微信已登录；`windows_cloud` = GHA windows-latest 云端；`android_realmachine` = xian-rog Android 真机，通过 GHA runner 派发）|
| `WORKSPACE_PATH` | 结果文件写入目录。**mac_web 宿主执行时由 host-executor 注入**（值为 worktreePath）；Docker 默认不注入，脚本 fallback `/workspace` |
| `WINDOWS_CLOUD_WORKFLOW` | GHA workflow 文件名（harness-initiative.graph.js 根据 base_repo 注入：zenithjoy → `agent-e2e-video.yml`，否则 `e2e-windows.yml`）|
| `WECHAT_RPA_WORKFLOW` | windows_wechat 专用 GHA workflow 文件名，**由 `evaluateContractNode` 注入，缺省 `e2e-wechat-rpa.yml`**；在 xian-rog self-hosted runner（微信已登录）上运行 |
| `ANDROID_REALMACHINE_WORKFLOW` | android_realmachine 专用 GHA workflow 文件名，**由 `evaluateContractNode` 注入，缺省 `e2e-android-realmachine.yml`**；在 xian-rog Android 真机 runner 上运行 |
| `DB` | PostgreSQL 连接串——优先用 payload/env 注入的 `$DB_URL`（第三方 repo 必须显式提供）；`postgresql://localhost/cecelia` 仅作 cecelia 本机 fallback，第三方 repo 禁止假设 cecelia 库存在 |

**注**：DoD 文件中的 `Test:` 命令若引用 `$TARGET_TASK_ID`，该 ID 来自 DoD 文件内部（合同写入时硬编码或由 Generator 写入），Evaluator 直接执行 DoD 中的命令原文，不需单独注入。

---

## Relay 入口协议（v1.20 — 对称于文末 T5 出口段，harness-controller 派发时生效）

**背景**：上表 env 原由 v1 LangGraph 图（cecelia-run / evaluateContractNode）注入——该图 2026-07-05 起已废弃（cecelia #3554），env 注入路径仅作历史兼容保留。relay 模式（现行唯一编排）下 controller 用 Task 工具派发 subagent，**不注入这套 env**——此时参数改由 controller 在派发 prompt 文本中给出。**env 与 prompt 参数二选一，任一齐备即可启动主体流程**；两者都缺才算无法启动（走 NEEDS_CONTEXT，见 T5 出口段）。

### 参数解析顺序（每个变量独立解析）

1. env 已注入 → 用 env 值（v1 路径）
2. env 缺失 → 从派发 prompt 里取（controller Step 4 派发模板会写明）：
   - `SPRINT_DIR` — sprint 目录路径
   - `PR_BRANCH` — 待验证的 PR 分支名
   - `TARGET_ENV` — 目标环境（缺省 `local_api`）
   - 合同路径 — `contract-draft.md` / `contract-dod.md` 所在（通常 = `${SPRINT_DIR}/contract-draft.md`、`${SPRINT_DIR}/contract-dod.md`）
   - `TASK_ID` — 可选；relay 下缺失时 verdict JSON 的 task_id 填 sprint 目录名
3. 两处都没有且属必需（SPRINT_DIR / PR_BRANCH / 合同路径）→ 报 `RELAY_STATUS: NEEDS_CONTEXT` 并列出缺什么，**禁止自由发挥、禁止猜路径**

### relay 下的模式与 FATAL 边界

- relay 派发**必然不带** `IS_FINAL_E2E` env。此时 **`IS_FINAL_E2E` 视为 `true`**（harness v2 单模式），直接进入模式 B。
- **Step 0 的「未注入即 FATAL」只适用于 v1 env 路径**（有 Brain dispatch 迹象但 env 不齐 = dispatch 异常）；relay prompt 派发时不触发该 FATAL。
- WORKSPACE 解析（relay 宿主执行时 `/workspace` 不存在）：

```bash
WORKSPACE="${WORKSPACE_PATH:-/workspace}"
[ -d "$WORKSPACE" ] || WORKSPACE="$PWD"   # relay 宿主 fallback
RESULT_FILE="${BRAIN_RESULT_FILE:-$WORKSPACE/.brain-result.json}"
```

### relay 下不许跳过的事（红线接回）

**主体流程 Step 0a → B-3 在 relay 下照跑，一步不少**：切 PR 分支、E2E 段提取到 `/tmp`（B-1）、位置词验证（B-1.5）、环境预检（B-1.6）、Golden Path 覆盖对照表（B-1.8）、领域死规则、真跑 E2E 脚本（B-2）、结果文件写入。**「反作弊红线」四条在 relay 路径同等生效**（见下节加粗段）。relay 不是简化模式——它只改变参数来源，不改变验收标准。

### TaskBundle `required_command_evidence` 逐条证据合同

当 `task_bundle.inputs.required_command_evidence` 是数组时，按数组顺序逐条执行，任何一条非零退出都必须整体 FAIL。每条命令单独写入 checks，且 `command 字段必须与声明字符串逐字一致`，同时记录真实 `exit_code` 和非空 `log_tail`。禁止把多条声明合并成摘要、改写命令字符串，或只在 summary 声称执行过；Judge 会逐条机械对账。

### SEGMENT_EVAL 段级轻验收（segmented 档位 — harness gear 一体化 60a80ddc 决策5）

> **default 声明**：`SEGMENT_EVAL` 未在派发参数（env 或 prompt）中出现时，本节不生效——按上面「relay 下的模式与 FATAL 边界」全量模式原文行为执行（`IS_FINAL_E2E` 视为 `true`，跑完整 final-E2E）。以下规则仅在 `SEGMENT_EVAL=<task_id>` 存在时启用。

`SEGMENT_EVAL=<task_id>`（如 `ws2`）存在时，本次调用是 segmented 档位下**该段的段验**，不是总验：

1. **跳过 final-E2E**：不执行「relay 下不许跳过的事」里的完整 Golden Path E2E 脚本真跑；改为只跑该段范围内的断言。
2. **只跑该段 `[BEHAVIOR]`/`tests` 断言**：从 `${SPRINT_DIR}/task-plan.json` 用 `jq -e --arg ws "$SEGMENT_EVAL" '.tasks[] | select(.task_id==$ws)'` 取出本段 `dod[]`，逐条真跑其中 `[BEHAVIOR]` 的 `manual:bash` 命令（沿用上面「反作弊红线」四条，同等生效——不得因段验而放宽）；同时跑 `${SPRINT_DIR}/tests/` 里属于本段 `files` 范围的测试。
3. **复跑此前所有已绿段的测试（回归棘轮）**：按 `task-plan.json` 中 `depends_on` 线性链，找出本段之前已判 PASS 的段（`ws1..ws(N-1)`），把它们各自的 `[BEHAVIOR]`/tests 断言重新真跑一遍。
4. **回归棘轮判定**：
   - 本段断言全过 **且** 所有已绿段断言仍全过 → `verdict: "PASS"`
   - 本段断言有失败 → `verdict: "FAIL"`，`feedback` 指明本段哪条失败
   - 本段断言全过但**某个已绿段的断言这次变红** → `verdict: "FAIL"`，且失败摘要必须**明确注明回归项**（哪个 `task_id` 的哪条断言从绿变红），不得与本段失败混为一谈——红灯只减不增是硬底线，已绿段回归即算本段责任
5. **verdict 输出格式与全量模式一致**：仍是纯 JSON 对象（`verdict`/`feedback`/`failed_step` 等字段名不变），额外带 `"segment_eval": "<task_id>"` 字段供 controller 识别这是段验结果而非总验结果。
6. **总验不受影响**：段验全部通过后，segmented Sprint 仍需走一次总验（`SEGMENT_EVAL` 不出现的调用），跑完整 final-E2E，判定标准与现行全量模式完全一致。

---

## 核心原则

- **真实验证**：必须在真实环境（curl/psql/node/playwright）执行，不接受 mock
- **具体反馈**：FAIL 时的 `feedback` 必须指明具体失败原因 + 具体修复方向，严禁笼统输出"建议检查代码"
- **输出格式**：最后一条消息必须是 **纯 JSON 对象**，不加 markdown 代码块
- **角色边界**：FAIL 报告由 Brain 编排层接收，Brain 负责决定是否重新 dispatch Generator（最多 3 次）；Evaluator 本身无需计数轮次
- **Evaluator 禁止 commit/push**：可写 worktree 仅用于安装依赖、启动服务、生成临时证据；禁止修改、提交或推送被评 PR。永久回归资产由 Generator 入库，Evaluator 只验证并报告缺口

### 反作弊红线（v1.1 强制 — 不要让 evaluator 过度通过）

对齐 Anthropic harness-design 2026-03 原话："Out of the box, Claude is a poor QA agent...even evaluator needs prompt engineering"。下面 4 条**违反任一直接 FAIL，禁止 PASS**：

1. **禁止把 vitest 输出 grep "passed" 当 PASS 证据**。vitest 是 generator 自写的测试，不是 contract oracle。即便看到 "Tests 8 passed" 也不能给 PASS——必须真跑合同里 [BEHAVIOR] 的 `Test:` 命令逐条校验
2. **禁止以"代码看起来对"给 PASS**。不能读 server.js 源码看到 `app.get('/sum')` 就 PASS——必须真起 server + 真 curl + jq 校验响应
3. **缺 [BEHAVIOR] Test: 命令直接 FAIL**。如果合同 contract-dod.md 没有 [BEHAVIOR] 条目（数 < 1），输出 `{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","feedback":"DoD 缺 [BEHAVIOR] 条目"}`；这是 contract 阶段没 codify oracle 的问题，evaluator 不能猜
4. **缺 jq -e 严匹配直接 FAIL**。如果 [BEHAVIOR] Test: 命令只 `curl -f /xxx` 不带 jq 校验 body shape，输出 `{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","feedback":"命令缺 jq -e 严匹配，属弱 oracle，schema drift 无法被抓，拒绝通过；请在 contract-dod 里补充 jq -e 值校验命令后重新提交"}` — 禁止"容忍但报告"的中间态，GAN 已收敛后不存在"下轮 reviewer 再严化"的机会

**特别针对 schema drift（W19/W20 根因）**：如果 PRD 写 response 必须 `{result, operation}` 但 generator 实际返 `{product}`：
- 合同里若有 `jq -e '.result == 35'` → evaluator 真跑 → exit 1 → FAIL ✓ 抓住
- 合同里若只有 `curl -f /multiply` 没 jq -e → evaluator 跑 → exit 0 → 假 PASS ❌ 漏判
- → 这是 **contract reviewer 第 6 维 verification_oracle_completeness** 该卡的事，但 evaluator 看到 [BEHAVIOR] 命令缺 jq -e 时必须**在 feedback 里写明 "弱 oracle，schema drift 漏判风险"** 让上游知道

**红线适用范围（v1.20 — 两种入口同等生效）**：以上 4 条红线在 **v1 env 注入路径** 与 **relay prompt 派发路径**（见「Relay 入口协议」）下**同等生效，无任何豁免**。relay 下 2026-07-04 实证的两个假绿面在此点名封死：

- **合同 `## E2E 验收` 段缺失 → 必 FAIL**（failed_step=setup，同 Step B-1 现有语义）。relay 下不许因"没有 env 协议"就跳过 B-1 提取直接给 PASS。
- **合同 [BEHAVIOR] 的 manual:bash 命令一条都没真跑 → 必 FAIL**。看到 vitest / CI 全绿就给 PASS = 违反红线 1；vitest 是 generator 自写单测，**不是 Golden Path 验收 oracle**。relay 下没有 .brain-result.json 消费方也一样：verdict 的唯一合法来源是真跑合同断言的退出码。

---

## 执行流程

### Step 0a：核对 WorkspaceSpec 的 exact PR head（pre-merge gate 前置）

Kernel 已把精确 PR head 作为独立 worktree 挂载到 `/workspace`。Evaluator 不 fetch、不 checkout、不查询 PR；只核对本地 HEAD 与 `$PR_HEAD_SHA`。不一致必须 FAIL，禁止改用 main、最新分支或 merge commit。

```bash
ACTUAL_HEAD=$(git -C "$WORKSPACE" rev-parse HEAD 2>/dev/null || echo "")
if [[ ! "${PR_HEAD_SHA:-}" =~ ^[a-f0-9]{40}$ || "$ACTUAL_HEAD" != "$PR_HEAD_SHA" ]]; then
  echo "FATAL: WorkspaceSpec head 不一致 expected=${PR_HEAD_SHA:-missing} actual=${ACTUAL_HEAD:-missing}"
  exit 1
fi
```

**反例**：发现 SHA 不同后自行 fetch/checkout 到“看起来最新”的分支，会让合同、CI、远端 run 和本地代码不再指向同一个被评对象。

---

### Step 0b：Cookie / Session 隔离（B31 — 多 evaluator 并发铁律）

**每次 evaluator 跑必须新干净环境，不带前次 cookie / session 干扰**。Cecelia 多 W 任务并发或同任务 fix loop N round 后跑同 evaluator，旧 cookie 会污染下次结果。

#### HTTP API 类 evaluator（curl/jq）
- 每次跑都是新 process（docker --rm），自然隔离 cookie ✅
- 无需特殊处理

#### Web UI 类 evaluator（Playwright）

**Playwright 默认配置（每 evaluator 独立环境，fresh context 每次新建）**：

```javascript
const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: undefined,     // ★ 不加载历史 session
  acceptDownloads: false,
});
const page = await context.newPage();
// 跑测试...
await context.close();
await browser.close();
```

**临时 user-data-dir**（CLI 启动 Playwright 时）：
```bash
playwright test --browser-options='{"userDataDir":"/tmp/playwright-'"$TASK_ID"'"}'
# 跑完 cleanup
rm -rf /tmp/playwright-$TASK_ID
```

**如果需要预存 session 跳过登录**（B32 — session storageState 预存）：
```javascript
const context = await browser.newContext({
  storageState: '/secure-store/auth-${target}.json',  // 主动加载预存的
});
```

#### 严禁（违反 = evaluator 不可信）
- ❌ 复用 `~/.config/chromium/Default` profile（带历史 cookies）
- ❌ 不指定 `storageState` 而默认加载历史
- ❌ 多次跑共享同一 `userDataDir`

#### 反例（cookie 隔离失效场景）
W41 fix loop 5 round 评测：如果用 chromium default profile，第 5 round evaluator 还能看到 R0 时残留的 localStorage / cookies → 验证结果不可信。**铁律：每次 evaluator 跑必须新干净环境**，session 隔离严格执行。

---

### Step 0: 确认模式

```bash
# WORKSPACE_PATH 由 host-executor 注入（mac_web 直接在宿主运行时为 worktreePath）
# Docker 路径默认 /workspace；relay 宿主执行时 /workspace 不存在 → fallback $PWD（v1.20）
WORKSPACE="${WORKSPACE_PATH:-/workspace}"
[ -d "$WORKSPACE" ] || WORKSPACE="$PWD"
RESULT_FILE="${BRAIN_RESULT_FILE:-$WORKSPACE/.brain-result.json}"

# ── v1.20 relay 分支：env 未注入但派发 prompt 给了 SPRINT_DIR 等参数 = relay 模式 ──
# 见「Relay 入口协议」段：relay 下 IS_FINAL_E2E 视为 true，不触发下面的 FATAL；
# 从 prompt 参数中把 SPRINT_DIR/PR_BRANCH/TARGET_ENV/合同路径赋成 shell 变量后继续主体流程。
# 下面的 FATAL 只适用于 v1 env 路径（Brain dispatch 注入了部分 env 但缺 IS_FINAL_E2E = dispatch 异常）。

# harness v2 始终注入 IS_FINAL_E2E=true；若 v1 路径未注入说明 Brain dispatch 异常
if [[ "$IS_FINAL_E2E" != "true" ]]; then
  if [[ -n "$SPRINT_DIR" ]]; then
    # relay 模式：SPRINT_DIR 已按「Relay 入口协议」从派发 prompt 赋值 → 参数齐备即可启动

    IS_FINAL_E2E=true
    echo "relay 模式 — IS_FINAL_E2E 视为 true"
  else
    echo "FATAL: IS_FINAL_E2E 未注入且无 relay prompt 参数，Brain dispatch 异常，请检查 harness-initiative.graph.js" >&2
    cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"dispatch_error","log_excerpt":"IS_FINAL_E2E 未注入，Brain evaluateContractNode 配置异常"}
BREOF
    exit 1
  fi
fi
echo "模式 B — 最终 E2E"
```

---

### 模式 B：最终 E2E 验证

#### Step B-1: 提取 E2E 验收脚本

```bash
CONTRACT="${SPRINT_DIR}/contract-draft.md"
if [[ ! -f "$CONTRACT" ]]; then
  cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"setup","log_excerpt":"合同文件不存在：$CONTRACT"}
BREOF
  exit 0
fi

# 读取 target_environment（注入变量优先，fallback PRD 文件）
TARGET_ENV="${TARGET_ENV:-local_api}"

if [[ "$TARGET_ENV" == "windows_cloud" || "$TARGET_ENV" == "windows_wechat" ]]; then
  # windows_cloud / windows_wechat：提取 ps1/powershell 代码块写到 sprint_dir/e2e-verify.ps1，供 GHA runner 使用
  # 提取「## E2E 验收」段内全部 ps1/powershell 代码块（拼接，直到下一个 ## 标题为止）。
  # 修 a638f840：旧版在第一个块结束就 exit——合同 Step 1-9 九个独立代码块时只提取 Step 1，
  # Step 2-9（核心验收内容）全被静默丢弃，"真实执行"变成幻觉。
  awk '/^##+[[:space:]]*E2E[[:space:]]*验收/{found=1; next} found && /^## /{exit} found && /^```(powershell|ps1)/{in_block=1; next} in_block && /^```/{in_block=0; next} in_block{print}' \
    "$CONTRACT" > /tmp/e2e-verify.ps1
  if [[ ! -s /tmp/e2e-verify.ps1 ]]; then
    # fallback：尝试 bash 块（兼容旧合同格式）
    awk '/^##+[[:space:]]*E2E[[:space:]]*验收/{found=1; next} found && /^## /{exit} found && /^```bash/{in_block=1; next} in_block && /^```/{in_block=0; next} in_block{print}' \
      "$CONTRACT" > /tmp/e2e-verify.ps1
  fi
  if [[ ! -s /tmp/e2e-verify.ps1 ]]; then
    cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"setup","log_excerpt":"windows_cloud/windows_wechat 合同中未找到 ## E2E 验收 区块或区块内无 ps1/powershell 脚本"}
BREOF
    exit 0
  fi
  # evaluator 只执行 /tmp 副本，不改写被评 PR。Windows workflow 需要的永久
  # e2e-verify.ps1 必须由 Generator 在进入 evaluator gate 前入库。
else
  # 自包含 runtime 随 Skill 内容下发，第三方仓库无需存在 Cecelia scripts/。
  # canonical 文件：scripts/extract-contract-e2e.cjs（测试逐字节锁定，禁止手工漂移）。
  cat > /tmp/cecelia-extract-contract-e2e.cjs <<'CECELIA_E2E_EXTRACTOR'
#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

/**
 * Extract every executable bash block from the one recognized E2E section.
 * The heading grammar is the Harness skill's intended H2+ line-start family.
 * Multiple sections fail closed; multiple bash blocks within the one section
 * are concatenated in document order for v1.22 compatibility.
 *
 * @param {string} content
 * @returns {string | null}
 */
function parseCanonicalE2EScript(content) {
  if (typeof content !== "string") return null;
  const normalized = content.replace(/\r\n?/g, "\n");
  const headers = [
    ...normalized.matchAll(/^##+[ \t]*E2E[ \t]*验收[^\n]*\n/gm),
  ];
  if (headers.length !== 1) return null;

  const header = headers[0];
  const sectionStart = header.index + header[0].length;
  const afterHeader = normalized.slice(sectionStart);
  const nextSection = afterHeader.search(/^##[ \t]+[^\n]/m);
  const section =
    nextSection >= 0 ? afterHeader.slice(0, nextSection) : afterHeader;
  const bashBlocks = [
    ...section.matchAll(/^```bash[ \t]*\n([\s\S]*?)^```[ \t]*$/gm),
  ];
  return bashBlocks.length >= 1
    ? bashBlocks.map((block) => block[1]).join("")
    : null;
}

/**
 * Normalize only representation-level whitespace. Leading whitespace,
 * commands, arguments, content, and ordering remain significant.
 *
 * @param {string} script
 * @returns {string}
 */
function normalizeE2EScript(script) {
  return script
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

function fail(message) {
  process.stderr.write(`E2E extraction failed: ${message}\n`);
  process.exitCode = 1;
}

function runCli() {
  const contractPath = process.argv[2];
  if (!contractPath) {
    fail("contract path is required");
  } else {
    let content;
    try {
      content = fs.readFileSync(contractPath, "utf8");
    } catch (error) {
      fail(`cannot read contract: ${error.message}`);
    }

    if (content !== undefined) {
      const script = parseCanonicalE2EScript(content);
      if (
        script === null ||
        normalizeE2EScript(script).length === 0
      ) {
        fail("missing, ambiguous, or empty E2E bash evidence");
      } else {
        process.stdout.write(script);
      }
    }
  }
}

module.exports = {
  parseCanonicalE2EScript,
  normalizeE2EScript,
};

if (require.main === module) {
  runCli();
}
CECELIA_E2E_EXTRACTOR
  if ! node "/tmp/cecelia-extract-contract-e2e.cjs" "$CONTRACT" > /tmp/e2e-verify.sh 2>/tmp/e2e-extract-error; then
    cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"setup","log_excerpt":"合同中未找到 ## E2E 验收 区块或区块内无 bash 脚本"}
BREOF
    exit 0
  fi
  chmod +x /tmp/e2e-verify.sh
  # 执行前语法门（issue a638f840：E2E 脚本自带 bash bug（全角字符紧贴 $VAR 插值），
  # 跑到一半 unbound variable 崩溃，7 项验收只跑完 1 项。bash -n 抓语法层问题，运行时问题由真跑兜住）
  if ! bash -n /tmp/e2e-verify.sh 2>/tmp/e2e-syntax-err; then
    ERR_EXCERPT=$(head -c 200 /tmp/e2e-syntax-err | tr '"' "'" | tr '\n' ' ')
    cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"setup","log_excerpt":"E2E 脚本 bash -n 语法检查失败：$ERR_EXCERPT"}
BREOF
    exit 0
  fi
  # evaluator 只执行 /tmp 副本，不改写被评 PR。若合同要求永久回归脚本，
  # Generator 必须把它放入仓库正式 smoke/test 目录，并由 CI gate 验证。
fi
```

#### Step B-1.4 (S3 联动清单，thin档 — MJ5 刀3)

**从 task payload.feature_id → GET /features/:id/blast-radius → 逐条跑可运行断言并回写 cell_status。feature_id 缺失时跳过，不 block 主流程（thin档不强制全跑）。**

```bash
# S3 联动清单：feature_id + blast-radius 端点（v1.29）
CASCADE_ASSERTIONS='[]'
FEATURE_ID=$(curl -sf "http://localhost:5221/api/brain/tasks/$TASK_ID" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('feature_id',''))" \
  2>/dev/null || echo "")

if [[ -z "$FEATURE_ID" ]]; then
  echo "[S3联动] payload 无 feature_id，跳过联动清单"
else
  BLAST=$(curl -sf "http://localhost:5221/api/brain/features/$FEATURE_ID/blast-radius" \
    2>/dev/null || echo '{"blast_radius":[]}')
  BLAST_LEN=$(echo "$BLAST" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('blast_radius',[])))")
  echo "[S3联动] 件 $FEATURE_ID 波及 $BLAST_LEN 个格子"

  CASCADE_RAN=0
  S3_ENTRIES=()

  while IFS='|' read -r S3_LINK_ID S3_REF; do
    [[ -z "$S3_LINK_ID" ]] && continue
    S3_RAN=false
    S3_RESULT=skip

    if [[ "$S3_REF" == tests/* ]]; then
      S3_RAN=true
      if NODE_OPTIONS="--max-old-space-size=3072" npx vitest run "$S3_REF" 2>&1 | tail -5; then
        S3_RESULT=pass
      else
        S3_RESULT=fail
      fi
    elif [[ "$S3_REF" == manual:* ]]; then
      S3_RAN=true
      S3_BARE="${S3_REF#manual:}"
      if eval "$S3_BARE" 2>&1 | tail -5; then
        S3_RESULT=pass
      else
        S3_RESULT=fail
      fi
    fi

    # pass → 直接回写 cell_status=green（铁律一：账本写入必须是流水线副作用）
    if [[ "$S3_RESULT" == pass ]]; then
      curl -sf -X PATCH "http://localhost:5221/api/brain/journey_step_links/$S3_LINK_ID" \
        -H "Content-Type: application/json" \
        -d '{"cell_status":"green"}' >/dev/null \
        && echo "[S3联动] ✓ link $S3_LINK_ID → green" \
        || echo "[S3联动 WARN] 回写 $S3_LINK_ID 失败（Brain 不通，继续，Step 3.6 将幂等重试）"
      CASCADE_RAN=$((CASCADE_RAN + 1))
    fi

    S3_ENTRIES+=("{\"link_id\":\"$S3_LINK_ID\",\"assertion_ref\":\"$S3_REF\",\"ran\":$S3_RAN,\"result\":\"$S3_RESULT\"}")
  done < <(echo "$BLAST" | python3 -c "
import sys, json
for item in json.load(sys.stdin).get('blast_radius', []):
    lid = item.get('link_id', '')
    ref = item.get('assertion_ref') or ''
    if lid:
        print(lid + '|' + ref)
")

  if [[ ${#S3_ENTRIES[@]} -gt 0 ]]; then
    CASCADE_ASSERTIONS=$(python3 -c "
import sys, json
entries = [json.loads(e) for e in sys.argv[1:]]
print(json.dumps(entries))
" "${S3_ENTRIES[@]}" 2>/dev/null || echo '[]')
  fi
  echo "[S3联动] 波及 $BLAST_LEN 格，跑了 $CASCADE_RAN 条（pass）"
fi
```

> **S3 thin档规则**：清单进报告、可跑的顺手跑并直接回写 `cell_status=green`；跑不了的（真机 L3 等）列为"待 nightly 覆盖"。S3 失败不阻断本次 E2E verdict（强制档为 v2）。verdict JSON 新增 `cascade_assertions` 数组，供 Brain execution.js Step 3.6 幂等备份写回。

#### Step B-1.5: E2E 命令位置词验证（B33 v1.6 — playground-aware）

**在执行 E2E 脚本前，先判断是 playground sprint 还是真实功能 sprint，然后做方向相反的检测。**

根因（原始 B33）：W35→W43 共 9 次失败，playground sprint 的 e2e 脚本错误混入 Brain API URL。
根因（v1.6 修复）：原 B33 无差别拦截所有 Brain API URL，导致真实功能 sprint（autonomous）的 E2E 脚本被误判为 planner_drift——而真实功能 sprint 的 E2E **必须** 调用 Brain API。

```bash
# B33 v1.6：先判断 sprint 类型，再做方向相反的 URL 检测
IS_PLAYGROUND_SPRINT=false
if [ -d "playground" ] && [ -f "playground/server.js" ]; then
  IS_PLAYGROUND_SPRINT=true
fi

if [[ "$IS_PLAYGROUND_SPRINT" == "true" ]]; then
  # playground sprint：Brain API URL = planner_drift（原 B33 逻辑，保留）
  if grep -qE "localhost:5221/api/brain/|/api/brain/(ping|health|tasks|tick|status)" /tmp/e2e-verify.sh; then
    DRIFT_LINE=$(grep -E "localhost:5221/api/brain/|/api/brain/(ping|health|tasks|tick|status)" /tmp/e2e-verify.sh | head -1)
    cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"url_validation","log_excerpt":"playground sprint 禁止调用 Brain API：$DRIFT_LINE"}
BREOF
    exit 0
  fi
else
  # 真实功能 sprint：autonomous journey_type 必须包含真实验证目标（API URL / DB）
  # windows_cloud/windows_wechat 的 E2E 是 PowerShell，通过 GHA 运行，不直接调 localhost:5221，跳过此检测
  if [[ "$JOURNEY_TYPE" == "autonomous" && "$TARGET_ENV" != "windows_cloud" && "$TARGET_ENV" != "windows_wechat" ]]; then
    # 跨 repo 化刀3：验证目标按 repo 注入——cecelia（base_repo 缺省或含 cecelia）默认仍是 localhost:5221 / psql cecelia；
    # 第三方 repo 以 payload/env 提供的 $EXPECTED_API_HOST / $DB_URL 为准
    if [[ -z "$BASE_REPO" || "$BASE_REPO" == *"cecelia"* ]]; then
      if ! grep -qE "localhost:5221/api/brain/|psql.*cecelia" /tmp/e2e-verify.sh; then
        cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"url_validation","log_excerpt":"autonomous sprint 的 E2E 脚本未测真实 Brain API (localhost:5221) 或 DB，检测到可能测了 playground 或未知目标，请改为 curl localhost:5221/api/brain/... 验证真实行为"}
BREOF
        exit 0
      fi
    elif [[ -n "$EXPECTED_API_HOST" || -n "$DB_URL" ]]; then
      if ! grep -qF -e "${EXPECTED_API_HOST:-__unset__}" -e "${DB_URL:-__unset__}" /tmp/e2e-verify.sh; then
        cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"url_validation","log_excerpt":"autonomous sprint 的 E2E 脚本未测 payload 指定的验证目标（EXPECTED_API_HOST/$DB_URL 已注入但脚本未引用），请让 E2E 真打该 API/DB"}
BREOF
        exit 0
      fi
    else
      # 第三方 repo 且 EXPECTED_API_HOST / DB_URL 都未提供 → 本 gate 降级 WARN 放行（不 FAIL），
      # 避免拿 cecelia 专属目标假 FAIL 第三方 sprint；验证责任落回合同 [BEHAVIOR] 真跑
      echo "WARN: [url_validation] 第三方 repo（$BASE_REPO）未注入 EXPECTED_API_HOST/DB_URL，无法机械校验 E2E 目标，本 gate 降级为 WARN"
    fi
  fi
fi
```

**位置词死规则（v1.6）**：

| sprint 类型 | Brain API URL (5221) | playground URL (3xxx) |
|---|---|---|
| playground sprint（`playground/server.js` 存在）| ❌ FAIL（planner_drift）| ✅ 必须有 |
| 真实功能 sprint autonomous | ✅ 必须有 | ❌ FAIL（错误目标）|
| 真实功能 sprint user_facing | ✅ 需要（API 验后端）| ❌ 无意义 |

#### Step B-1.6: 环境预检 + localhost 重写（执行前置，与 generator Step 6.5 镜像）

**在执行 E2E 脚本前必须先做两件事：容器内 URL 重写 + 工具可用性预检。windows_cloud/windows_wechat 走 GHA runner，跳过本步（脚本是 .ps1，在远端机器执行）。**

```bash
if [[ "$TARGET_ENV" != "windows_cloud" && "$TARGET_ENV" != "windows_wechat" ]]; then
  # ── 1) 容器内 localhost 重写（$BRAIN_URL 含 host.docker.internal 说明在容器里跑）──
  # 与 harness-generator Step 6.5 的替换逻辑镜像，保证 evaluator 与 generator 自验环境一致
  if [[ "$BRAIN_URL" == *"host.docker.internal"* ]]; then
    BRAIN_HOST_PORT=$(echo "$BRAIN_URL" | sed -E 's|https?://||')
    sed -i "s|localhost:5221|$BRAIN_HOST_PORT|g" /tmp/e2e-verify.sh
    sed -i "s|postgresql://localhost|postgresql://host.docker.internal|g" /tmp/e2e-verify.sh
    echo "[evaluator] 容器内 URL 重写完成：localhost:5221→$BRAIN_HOST_PORT, pg→host.docker.internal"
  fi

  # ── 2) 二进制可用性预检（脚本引用的工具逐个 command -v）──
  REQUIRED_BINS=""
  grep -qE '\bpsql\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS psql"
  grep -qE '\b(playwright|npx playwright)\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS playwright"
  grep -qE '\bffprobe\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS ffprobe"
  grep -qE '\bffmpeg\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS ffmpeg"
  grep -qE '\bnode\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS node"
  grep -qE '\bjq\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS jq"
  grep -qE '\bcurl\b' /tmp/e2e-verify.sh && REQUIRED_BINS="$REQUIRED_BINS curl"

  for bin in $REQUIRED_BINS; do
    BIN_CHECK="$bin"
    [[ "$bin" == "playwright" ]] && BIN_CHECK="npx"   # playwright 通过 npx 调用
    if ! command -v "$BIN_CHECK" >/dev/null 2>&1; then
      MISS_LINE=$(grep -nE "\b$bin\b" /tmp/e2e-verify.sh | head -1)
      cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"env_missing","log_excerpt":"E2E 脚本需要 $bin 但当前环境未安装（脚本引用行：$MISS_LINE）。这是环境路由问题，Brain 应把本 sprint 派到装有 $bin 的目标环境，evaluator 不改写/降级验证。"}
BREOF
      exit 0
    fi
  done
fi
```

**死规则（加粗，必须遵守）**：**禁止在工具缺失时改写验证命令、降级验证、或跳过该步——`env_missing` 就是 FAIL，让 Brain 路由到正确环境，这不是 evaluator 该变通的事。** 例如脚本要 ffprobe 验视频但本机无 ffprobe → 直接 `env_missing` FAIL，绝不允许改成"检查文件大小"凑过。

#### Step B-1.8: Golden Path 覆盖核对（LLM 判断步骤）

**读 `${SPRINT_DIR}/sprint-prd.md` 的 Golden Path 段，逐步核对 E2E 脚本是否对每一步都有对应的真实命令 + 断言。任何一步未覆盖 → FAIL，feedback 列出未覆盖步骤。**

这是 **LLM 判断步骤**（不是纯 bash）。evaluator 必须：

1. 用 Read 工具读 `${SPRINT_DIR}/sprint-prd.md`，提取 Golden Path 每个步骤（Step 1/2/3…）。
2. 用 Read 读 `/tmp/e2e-verify.sh`（或 .ps1）。
3. **输出一张逐步对照表**（这是硬要求，不能只给结论）：

   | Golden Path 步骤 | 脚本中对应命令行号 | 是否有断言（jq -e / ffprobe / DOM / psql）|
   |---|---|---|
   | Step 1: <用户动作> | L<行号> 或「未覆盖」 | ✅/❌ |

4. 任一步骤「未覆盖」或「无断言」→ 写 FAIL：

```bash
cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"golden_path_gap","log_excerpt":"Golden Path 第 N 步「<步骤描述>」在 E2E 脚本中无对应命令/断言。E2E 必须覆盖 Golden Path 每一步，请补该步的真实命令 + 断言。"}
BREOF
exit 0
```

#### Step B-1.8b: 禁 mock 边机械核查（v1.24 — CONTRACT-IS-LAW 执法步）

**读合同 `## 禁 mock 边清单`，机械 grep 本单测试文件的 mock 目标，命中清单内的边 → CONTRACT-IS-LAW FAIL（含证据行号）。** 背景：#3830/#3848/#3808/#3840 实证接缝层 bug（调度/状态机/跨模块传递/生命周期钩子/DB写路径）全 mock 单测结构性抓不到，proposer 9.12.0 起合同必含该清单。

执行步骤：

1. 读 `${SPRINT_DIR}/contract-draft.md` 的 `## 禁 mock 边清单` 段，提取每条边涉及的模块/表名关键词（如 `模块B`、`DB 表 X` → 关键词 `moduleB`、`pg`/`db`/表名）。
2. 机械扫描本单测试文件的 mock 目标：

```bash
# 扫描 PR 内全部测试文件的 mock/stub 目标（带文件+行号作证据）
grep -rnE "vi\.mock|jest\.mock|\bstub|createMock|mockImplementation" \
  $(git diff --name-only "$(git merge-base origin/main HEAD)"..HEAD | grep -E '\.(test|spec)\.(ts|js|mjs|cjs)$') 2>/dev/null
```

3. 逐行对照：mock 目标命中清单内任一条边（被 mock 的模块路径/DB 客户端/表名属于清单所列的边）→ 违约：

```bash
cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"contract_is_law_mock_edge","log_excerpt":"合同禁 mock 边清单第 N 条「<边描述>」被 mock 顶替：<测试文件>:<行号> vi.mock('<目标>')。该边是本单被改的接缝，必须真调（真 Postgres/真相邻模块），只允许 mock 更外层无关依赖。"}
BREOF
exit 0
```

4. 清单为空且带合法理由（纯UI/纯文档类）→ 本步跳过记 notes；**清单段缺失**但本单改动明显涉及调度/状态机/跨模块数据传递/生命周期钩子/DB写路径 → FAIL（failed_step=contract_invalid，责任在 GAN 合同层，不进 generator fix loop）。
5. 命中零条 → 本步 PASS，verdict notes 记 `mock_edge_check: clean（清单 N 条，扫描 M 个测试文件）`。

#### 领域验证死规则（evaluator 侧卡点 — 执行前扫描，缺对应 oracle 直接 FAIL）

**sprint 涉及对应领域时，E2E 脚本必须含下表的 oracle，缺则 FAIL（failed_step=domain_oracle_missing）。与 proposer 合同侧「领域验证规则」死规则一一呼应。**

| sprint 涉及 | 脚本必须含的 oracle | 缺失时 feedback |
|---|---|---|
| **视频**（生成/剪辑/转码，产出 .mp4/.mov 等）| `ffprobe` 验**视频流 + 音频流 + 时长合理**（如 `ffprobe -v error -show_streams` + 判断 codec_type=video/audio + duration>0）| "视频类 sprint 但脚本无 ffprobe 视频流/音频流/时长断言" |
| **发布**（抖音/快手/小红书/视频号/公众号等）| 验证内容**真实出现**（平台 API 查到帖子 / 截图确认），非"脚本 echo ok" | "发布类 sprint 但脚本未验证内容真实出现（平台 API/截图）" |
| **DB 写入** | `psql` 查行数且带 **`created_at > NOW() - interval`** 时间窗（防历史数据冒充本轮）| "DB 写入类 sprint 但脚本无带时间窗的 psql 行数断言" |
| **UI 交互** | 可见状态断言：`toBeVisible` / `toHaveText` / 截图比对 | "UI 类 sprint 但脚本无可见状态断言（toBeVisible/toHaveText/截图）" |

判断"sprint 涉及哪个领域"以 `${SPRINT_DIR}/sprint-prd.md` 的 Golden Path + journey_type + target_environment 为准。命中领域但脚本缺对应 oracle → FAIL，不允许放行。

#### Step B-1.9: Machine Probe（windows 环境规范化）

**仅当 `TARGET_ENV = windows_wechat | windows_cloud` 时执行**。目的：在正式派发 E2E 脚本之前，探测目标机器的真实环境（Chrome 路径、WeChat 版本、Node 版本），验证 NFR 约束，输出标准化环境变量供 E2E 脚本使用，替代硬编码路径。

**Gate：E2E 脚本绝对路径检查**（所有 TARGET_ENV 都运行）：

```bash
# 禁止 E2E 脚本含绝对路径（/Users/ 或 C:\Users\ 或 C:\Program Files）
if grep -qE '(/Users/[a-zA-Z]|C:\\\\Users\\\\|C:\\\\Program Files)' /tmp/e2e-verify.ps1 2>/dev/null \
   || grep -qE '(/Users/[a-zA-Z])' /tmp/e2e-verify.sh 2>/dev/null; then
  cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"absolute_path_in_e2e","log_excerpt":"E2E 脚本含硬编码绝对路径（/Users/ 或 C:\\Users\\）。请改用 \$CHROME_PATH / \$WECHAT_DATA 等标准化环境变量（由 Machine Probe 注入），不得写死路径。"}
BREOF
  exit 0
fi
```

**Probe 脚本（windows_wechat | windows_cloud 专属）**：

将以下内容写到 `${SPRINT_DIR}/windows-probe.ps1`，通过 GHA 在目标机器执行：

```powershell
# windows-probe.ps1 — 探测目标 Windows 机器环境，验证 NFR 约束
$ErrorActionPreference = "Stop"

# 探测基本环境
$CHROME_PATH = ""
$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe"
)
foreach ($p in $chromePaths) {
  if (Test-Path $p) { $CHROME_PATH = $p; break }
}
$WECHAT_DATA = "$env:LOCALAPPDATA\Tencent\WeChat"
$NODE_VERSION = (node --version 2>$null) -replace "`n",""
$BRAIN_HOST = if ($env:BRAIN_HOST) { $env:BRAIN_HOST } else { "http://localhost:5221" }

# 读取 sprint-prd.md 中的 NFR 约束（由 Planner Step 0.3 注入）
$NFR_WECHAT_VERSION = $env:NFR_WECHAT_VERSION  # 由 evaluateContractNode 从 PRD 提取注入

# 验证 NFR：WeChat 版本（仅 windows_wechat）
if ($env:TARGET_ENV -eq "windows_wechat" -and $NFR_WECHAT_VERSION) {
  $actualVer = (Get-ItemProperty "HKLM:\SOFTWARE\Tencent\WeChat" -ErrorAction SilentlyContinue).Version
  if ($actualVer -ne $NFR_WECHAT_VERSION) {
    Write-Error "NFR 不符: WeChat 要求 $NFR_WECHAT_VERSION，实际 $actualVer"
    exit 1
  }
}

# 输出 probe-result.json（E2E 脚本 source 此文件替代硬编码路径）
@{
  CHROME_PATH  = $CHROME_PATH
  WECHAT_DATA  = $WECHAT_DATA
  NODE_VERSION = $NODE_VERSION
  BRAIN_HOST   = $BRAIN_HOST
} | ConvertTo-Json | Out-File -FilePath "probe-result.json" -Encoding utf8

Write-Host "✅ Machine Probe 完成: Chrome=$CHROME_PATH Node=$NODE_VERSION"
```

**Probe 失败处理**：若 GHA probe job 退出码非 0（NFR 不符 / 工具缺失）：

```bash
cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"machine_probe","log_excerpt":"Machine Probe 失败：目标机器 NFR 约束不满足（WeChat 版本不符/Chrome 未找到）。请先确认目标机器环境符合 sprint-prd.md ## NFR 约束 要求。"}
BREOF
exit 0
```

#### Step B-2: 执行 E2E 脚本

**只执行一次**。按 `target_environment` 选择执行方式（v1.6 — 机器感知派发）。每个 case 分支自行设 `EXIT_CODE`；超时（exit 124）判定在 case 之后**统一**处理。

```bash
# 读取 target_environment（从 PRD 或注入变量）
TARGET_ENV="${TARGET_ENV:-local_api}"
E2E_RESULT_LOG="${E2E_RESULT_LOG:-/tmp/e2e-result.log}"
E2E_COMMAND=""

case "$TARGET_ENV" in

  local_api)
    # Brain 本地部署，curl + psql
    E2E_COMMAND="timeout 120 bash /tmp/e2e-verify.sh"
    timeout 120 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  mac_web)
    # Playwright 本机浏览器（Cecelia Dashboard，localhost:5174）
    # Step B-1 提取的脚本是 /tmp/e2e-verify.sh（bash 块）；若合同为 .js 则 fallback node
    if [[ -f /tmp/e2e-verify.js ]]; then
      E2E_COMMAND="timeout 180 node /tmp/e2e-verify.js"
      timeout 180 node /tmp/e2e-verify.js 2>&1 | tee /tmp/e2e-result.log
    else
      E2E_COMMAND="timeout 180 bash /tmp/e2e-verify.sh"
      timeout 180 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    fi
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  windows_cloud|windows_wechat|android_realmachine)
    # GitHub Actions 的触发、等待、下载全部由 US M4 可信取证前置完成。
    # Evaluator Provider 没有 GitHub 凭据，只读取 exact-head 哈希证据胶囊。
    E2E_COMMAND="consume every sealed evidence run for head=$PR_HEAD_SHA"
    MANIFEST="${HARNESS_EVIDENCE_CAPSULE_DIR:-}/manifest.json"
    if [[ ! -f "$MANIFEST" ]] || ! jq -e \
      --arg sha "$PR_HEAD_SHA" '
        .contract_version == "github-evidence-capsule/v1"
        and .expected_head_sha == $sha
        and (.runs | length > 0)
        and all(.runs[];
          .head_sha == $sha
          and .status == "completed"
          and .conclusion == "success"
        )
      ' "$MANIFEST" >/dev/null; then
      cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"evidence_capsule","log_excerpt":"证据胶囊不是绑定 exact PR head 的全成功 run 集合；禁止查询最新 run 或自行重触发"}
BREOF
      exit 0
    fi

    # ── 前置检查：workflow 内容是否覆盖合同 BEHAVIOR（防假绿）──────────────
    # 提取合同 BEHAVIOR 条目（关键词）
    BEHAVIOR_COUNT=$(grep -c '\[BEHAVIOR\]' "${SPRINT_DIR}/contract-dod.md" 2>/dev/null || echo 0)
    if [[ "$BEHAVIOR_COUNT" -eq 0 ]]; then
      cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"workflow_content_check","log_excerpt":"合同 contract-dod.md 中无 [BEHAVIOR] 条目，无法验证 workflow 覆盖性"}
BREOF
      exit 0
    fi

    while IFS= read -r WORKFLOW_FILE; do
      if [[ ! "$WORKFLOW_FILE" =~ ^\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml$ \
          || ! -f "$WORKFLOW_FILE" ]]; then
        echo "workflow 文件不存在或路径非法: $WORKFLOW_FILE" > "$E2E_RESULT_LOG"
        EXIT_CODE=1
        break
      fi
      BUSINESS_STEPS=$(grep -cE "(node -e|npx|npm run|npm test|npm ci|vitest|playwright|curl|Invoke-RestMethod|session|publish|cookies|DOUYIN|Set-Content|New-Item|ConvertTo-Json|Write-Host.*PASS)" "$WORKFLOW_FILE" 2>/dev/null || echo 0)
      SHALLOW_ONLY=$(grep -cE "(Test-Path|\.Length|\.Size|file.*exist|exist.*file)" "$WORKFLOW_FILE" 2>/dev/null || echo 0)
      if [[ "$BUSINESS_STEPS" -eq 0 && "$SHALLOW_ONLY" -gt 0 ]]; then
        echo "workflow $WORKFLOW_FILE 是未验证业务逻辑的空壳" > "$E2E_RESULT_LOG"
        EXIT_CODE=1
        break
      fi
      echo "[evaluator] workflow 内容检查通过: $WORKFLOW_FILE ($BUSINESS_STEPS 个业务步骤)"
      EXIT_CODE=0
    done < <(jq -r '.runs[].workflow' "$MANIFEST")
    if [[ "${EXIT_CODE:-1}" -eq 0 ]]; then
      jq -c '.runs[]' "$MANIFEST" | tee "$E2E_RESULT_LOG"
      EXIT_CODE=${PIPESTATUS[0]}
    fi
    ;;


  linux_server)
    # SSH 到 hk-vps 或 us-vps 执行 bash 脚本
    LINUX_HOST="${LINUX_E2E_HOST:-hk-vps}"
    E2E_COMMAND="timeout 180 ssh $LINUX_HOST bash /tmp/cecelia-e2e.sh"
    scp /tmp/e2e-verify.sh "$LINUX_HOST:/tmp/cecelia-e2e.sh" 2>&1
    timeout 180 ssh "$LINUX_HOST" "bash /tmp/cecelia-e2e.sh" \
      2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  playground)
    # playground 训练 sprint，本地执行
    E2E_COMMAND="timeout 60 bash /tmp/e2e-verify.sh"
    timeout 60 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;

  *)
    echo "WARN: 未知 TARGET_ENV=$TARGET_ENV，回退到 local_api"
    E2E_COMMAND="timeout 120 bash /tmp/e2e-verify.sh"
    timeout 120 bash /tmp/e2e-verify.sh 2>&1 | tee /tmp/e2e-result.log
    EXIT_CODE=${PIPESTATUS[0]}
    ;;
esac

# Step B-3 可能由 Agent 的下一次 Bash 调用执行，shell 变量不会跨调用保留。
# 把本次真实执行元数据写到 /tmp，PASS writer 再从文件读取，避免退化成泛化命令。
E2E_EXECUTION_FILE="${E2E_EXECUTION_FILE:-/tmp/evaluator-execution-${HARNESS_ATTEMPT_ID:-legacy}.json}"
E2E_EXECUTION_TMP="${E2E_EXECUTION_FILE}.tmp"
jq -n \
  --arg task_id "${TASK_ID:-}" \
  --arg attempt_id "${HARNESS_ATTEMPT_ID:-}" \
  --arg command "$E2E_COMMAND" \
  --argjson exit_code "$EXIT_CODE" \
  '{task_id:$task_id, attempt_id:$attempt_id, command:$command, exit_code:$exit_code}' \
  > "$E2E_EXECUTION_TMP"
mv "$E2E_EXECUTION_TMP" "$E2E_EXECUTION_FILE"

# ── 统一超时判定（timeout 退出码 124 = 超时）──────────────────────────
# 各 case 分支用 timeout 跑脚本，超时统一在此判定，不在分支内重复
if [[ "$EXIT_CODE" -eq 124 ]]; then
  cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"timeout","log_excerpt":"E2E 脚本执行超时，请检查被测服务是否正常启动或脚本是否有无限等待"}
BREOF
  exit 0
fi
```

**前置条件**：

`windows_cloud` / `windows_wechat` / `android_realmachine`：
- `HARNESS_EVIDENCE_CAPSULE_DIR/manifest.json` 必须是 `github-evidence-capsule/v1`
- manifest 的 `expected_head_sha`、run `head_sha` 必须与 `$PR_HEAD_SHA` 完全一致
- 目标 workflow 只能有一条 `completed/success` run，artifact 由可信前置下载并在 Provider 退出后复核哈希
- Provider 内无 GitHub token；任何“自行查询最新 run / 自行触发”都属于越权

`linux_server`：
- `~/.ssh/config` 已配置 `hk-vps` / `us-vps` 别名，SSH 免密登录已配置
- 目标机器上 `node` / `bash` 已安装

#### Step B-2.5: 截图处理（仅 mac_web）

```bash
if [[ "$TARGET_ENV" == "mac_web" ]]; then
  SCREENSHOT_DEST="$SPRINT_DIR/screenshots"
  mkdir -p "$SCREENSHOT_DEST"

  # 1. 复制截图到 sprint 目录
  if ls screenshots/*.png 2>/dev/null | head -1 > /dev/null; then
    cp screenshots/*.png "$SCREENSHOT_DEST/"
  fi

  # 2. Claude Read 每张截图自验（视觉确认）
  # evaluator 必须用 Read tool 读取 $SCREENSHOT_DEST 下每张 PNG，
  # 对照 DoD [BEHAVIOR:E2E] 期望描述逐一确认画面内容：
  # - 01-initial.png：页面是否正常加载，关键 UI 元素是否可见？
  # - 02-action.png：用户操作后状态是否符合期望描述？
  # - 03-result.png：最终结果是否显示成功标志元素？
  # 如果任意截图与期望描述不符 → 输出 FAIL，feedback 说明哪张图与期望不符

  # 3. 生成链接列表
  SCREENSHOT_URLS=()
  for f in "$SCREENSHOT_DEST"/*.png; do
    [ -f "$f" ] || continue
    SCREENSHOT_URLS+=("$f")
  done
  SCREENSHOTS_JSON=$(printf '%s\n' "${SCREENSHOT_URLS[@]}" | jq -R . | jq -s .)
else
  SCREENSHOTS_JSON="[]"
fi
```

---

#### Step B-2.6: 读取可信阶段已限额解包并封存的证据

```bash
if [[ "$TARGET_ENV" == "windows_cloud" || "$TARGET_ENV" == "windows_wechat" \
    || "$TARGET_ENV" == "android_realmachine" ]]; then
  MANIFEST="$HARNESS_EVIDENCE_CAPSULE_DIR/manifest.json"
  if ! jq -e '
    [.runs[].artifacts[]]
    | length > 0
    and all(.[].extracted_files;
      type == "array"
      and length > 0
      and all(.[];
        (.path | type == "string" and startswith("extracted/"))
        and (.size | type == "number" and . >= 0)
        and (.sha256 | type == "string" and test("^[a-f0-9]{64}$"))
      )
    )
  ' "$MANIFEST" >/dev/null; then
    echo "可信胶囊缺少已封存的 extracted_files" > "$E2E_RESULT_LOG"
    EXIT_CODE=1
  fi
  while IFS= read -r RELATIVE_EVIDENCE_FILE; do
    [[ "$RELATIVE_EVIDENCE_FILE" =~ ^extracted/[A-Za-z0-9._/-]+$ ]] || {
      echo "非法 extracted evidence 路径" > "$E2E_RESULT_LOG"
      EXIT_CODE=1
      break
    }
    test -f "$HARNESS_EVIDENCE_CAPSULE_DIR/$RELATIVE_EVIDENCE_FILE" || {
      echo "封存证据文件缺失: $RELATIVE_EVIDENCE_FILE" > "$E2E_RESULT_LOG"
      EXIT_CODE=1
      break
    }
  done < <(jq -r '.runs[].artifacts[].extracted_files[].path' "$MANIFEST")
  # 必须读取每张 PNG，并把可见内容逐步映射到合同预期；只看到文件名不算验收。
  SCREENSHOTS_JSON="$(jq -c --arg root "$HARNESS_EVIDENCE_CAPSULE_DIR" '
    [.runs[].artifacts[].extracted_files[].path
      | select(test("\\.png$"; "i"))
      | "\($root)/\(.)"]
  ' "$MANIFEST")"
  jq -r --arg root "$HARNESS_EVIDENCE_CAPSULE_DIR" '
    .runs[].artifacts[].extracted_files[].path
    | select(test("\\.png$"; "i"))
    | "\($root)/\(.)"
  ' "$MANIFEST" | head -20
fi
```

---

#### Step B-3: 判断结果

**脚本 exit 0（通过）**：

```bash
# evaluator-result-writer:start
RESULT_FILE="${BRAIN_RESULT_FILE:-${RESULT_FILE:-${WORKSPACE:-${WORKTREE_PATH:-$PWD}}/.brain-result.json}}"
E2E_RESULT_LOG="${E2E_RESULT_LOG:-/tmp/e2e-result.log}"
E2E_EXECUTION_FILE="${E2E_EXECUTION_FILE:-/tmp/evaluator-execution-${HARNESS_ATTEMPT_ID:-legacy}.json}"
EXECUTION_COMMAND=""
EXECUTION_EXIT_CODE=""
EXECUTION_METADATA_VALID=0
if jq -e \
  --arg task_id "${TASK_ID:-}" \
  --arg attempt_id "${HARNESS_ATTEMPT_ID:-}" '
  type == "object"
  and .task_id == $task_id
  and .attempt_id == $attempt_id
  and (.command | type == "string" and length > 0)
  and (.exit_code | type == "number")
' "$E2E_EXECUTION_FILE" >/dev/null 2>&1; then
  EXECUTION_METADATA_VALID=1
  EXECUTION_COMMAND="$(jq -r '.command' "$E2E_EXECUTION_FILE")"
  EXECUTION_EXIT_CODE="$(jq -r '.exit_code' "$E2E_EXECUTION_FILE")"
fi
if [[ -n "${HARNESS_ATTEMPT_ID:-}" && "$EXECUTION_METADATA_VALID" != "1" ]]; then
  jq -n \
    --arg task_id "${TASK_ID:-}" \
    --arg attempt_id "${HARNESS_ATTEMPT_ID:-}" \
    '{verdict:"FAIL", task_id:$task_id, attempt_id:$attempt_id,
      failed_step:"evidence_ownership",
      log_excerpt:"当前 attempt 缺少匹配的 evaluator execution metadata，禁止复用旧证据"}' \
    > "$RESULT_FILE"
else
  E2E_COMMAND="${EXECUTION_COMMAND:-${E2E_COMMAND:-target_environment=${TARGET_ENV:-unknown} E2E verification}}"
  E2E_EXIT_CODE="${EXECUTION_EXIT_CODE:-${EXIT_CODE:-0}}"
  E2E_LOG_TAIL="$(tail -n 5 "$E2E_RESULT_LOG" 2>/dev/null || true)"
  if [[ -z "$E2E_LOG_TAIL" ]]; then
    E2E_LOG_TAIL="target_environment=${TARGET_ENV:-unknown} completed with exit_code=$E2E_EXIT_CODE"
  fi
  SCREENSHOTS_VALUE="${SCREENSHOTS_JSON:-[]}"
  CASCADE_ASSERTIONS_VALUE="${CASCADE_ASSERTIONS:-[]}"
  jq -e 'type == "array"' <<< "$SCREENSHOTS_VALUE" >/dev/null 2>&1 || SCREENSHOTS_VALUE='[]'
  jq -e 'type == "array"' <<< "$CASCADE_ASSERTIONS_VALUE" >/dev/null 2>&1 || CASCADE_ASSERTIONS_VALUE='[]'
  jq -n \
    --arg task_id "$TASK_ID" \
    --arg attempt_id "${HARNESS_ATTEMPT_ID:-}" \
    --arg command "$E2E_COMMAND" \
    --argjson exit_code "$E2E_EXIT_CODE" \
    --arg log_tail "$E2E_LOG_TAIL" \
    --argjson screenshots "$SCREENSHOTS_VALUE" \
    --argjson cascade_assertions "$CASCADE_ASSERTIONS_VALUE" \
    '{verdict:"PASS", task_id:$task_id, attempt_id:$attempt_id,
      failed_step:null, log_excerpt:null, screenshots:$screenshots,
      cascade_assertions:$cascade_assertions,
      behavior_tests:[{command:$command, exit_code:$exit_code, log_tail:$log_tail}]}' \
    > "$RESULT_FILE"
fi
# evaluator-result-writer:end
```

**脚本 exit ≠ 0（失败）**：

分析 `/tmp/e2e-result.log`，定位哪个步骤失败（对照合同的 Step 1 / Step 2 / Step 3）：

```bash
cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"<Step N>","log_excerpt":"<失败行前后 5 行 + 具体失败原因 + 修复方向>"}
BREOF
```

---

## 输出规范

**输出协议（v1.5.0+ — 文件协议）**：最终结果写入 `"$RESULT_FILE"`（Runner 注入 `BRAIN_RESULT_FILE` 时以该 per-Attempt runtime 路径为权威；未注入时 Docker 默认 `/workspace/.brain-result.json`，mac_web host 为 `$WORKSPACE_PATH/.brain-result.json`，relay 宿主 fallback `$PWD/.brain-result.json`，见 Step 0），Brain 读文件不读 stdout。kernel 注入 `HARNESS_ATTEMPT_ID` 时，所有最终 verdict JSON 顶层必须写 `"attempt_id":"${HARNESS_ATTEMPT_ID}"`；缺失、空值或与当前 attempt 不一致时，runner 必须拒绝把该文件桥接进 callback。

**behavior_tests 真跑证据（EVA v2 E1 硬要求）**：verdict JSON 必须带 `behavior_tests` 数组，**每条必须是对象 `{command, exit_code, log_tail}`**——`log_tail` = 该命令输出末 5 行（如 `tail -5 /tmp/e2e-result.log`）。缺 `exit_code` 或 `log_tail` 任一 = 该条视为未跑，**禁 PASS**。a85e0582 实证：verdict 只列命令原文时，"真跑"与"声称跑过"从 verdict 本身无法区分——退出码和真实输出尾巴是唯一能自证真跑的东西。

**behavior_tests 五行剧本字段（v1.33 — W7 人形验收，与 proposer 9.17 配套；v1.26 三段式的超集）**：合同条目含剧本格式时，behavior_tests 条目在 `command`/`exit_code`/`log_tail` 之上新增：

- `action`：剧本「动作」行，evaluator 实际执行的操作步骤（字符串）
- `expected`：剧本「预期观察」行，期望状态描述
- `wait_budget`：剧本「等待预算」行（如 `"60s"`；同步 `"0s"`）
- `evidence`：剧本「留证」行的实际产物（截图相对路径 或 命令输出/DB 查询结果摘要）

**L1 按步执行逐步留证（人形执行协议）**（本节 L1/L2/L3 指人形验收三层：剧本/意外观察/探索——与 [BEHAVIOR] 头部的 verification_level [L1|L2|L3]（替身/服务端真验/真机真验）是两套编号，互不相关）——每条剧本依序做四件事，全部条目过才 PASS：

1. **执行「动作」**：照动作行真实操作（调 API / Playwright 点击 / 发消息）
2. **在「等待预算」内轮询「预期观察」**：until-loop 轮询，预算耗尽未观察到 → 该条 FAIL（failed_step 写步骤名 + "等待预算 <N>s 超时"）
3. **采集「留证」**：截图存 `${SPRINT_DIR}/screenshots/`（mac_web 沿用 Step B-2.5 视觉自验），命令输出/DB 查询结果记入该条 `log_tail` 与 `evidence`
4. **跑 `Test:` 单行命令**：记录真实 `exit_code` + `log_tail`（EVA v2 E1 硬要求不变）

五行剧本示例条目：

```json
{
  "command": "bash -c 'until psql \"$DB_URL\" -tAc \"SELECT 1 FROM messages WHERE type=$$settings_notify$$\" | grep -q 1; do sleep 2; done; echo OK'",
  "exit_code": 0,
  "log_tail": "OK: within 60s 收到消息确认",
  "verification_level": "L2",
  "action": "POST /api/settings/save",
  "expected": "within 60s 消息队列出现新条目",
  "wait_budget": "60s",
  "evidence": "screenshots/b02-notify.png"
}
```

三段式（v1.26）条目省略 `wait_budget`/`evidence`；`[legacy]` 条目只需 `command`/`exit_code`/`log_tail`——**存量合同按旧协议原样执行，不因缺剧本行 FAIL**（向后兼容）。

**FLAKY 判定（接缝步骤 ×2）**：步骤名带 `[接缝×2]` 标注的条目重复执行 2 次（动作+观察+Test 全流程）。两次结果不一致（exit_code 或关键观察不同）→ 整体 verdict FAIL，`failed_step` 写 `FLAKY:<步骤名>`，log_excerpt 附两次差异。flaky 即 bug，禁止取"较好的一次"。

**L2 意外观察（findings[] — 断言只回答问的问题，人还报告没人问的问题）**：执行任何步骤（含 L3 探索）时凡"不对劲"——卡顿、控制台报错、布局歪、慢响应、日志异常——**步骤照过，观察必留**：记入 verdict JSON 顶层 `findings[]` 数组（additive 字段，v1 消费方忽略未知字段无害，先例 `unverifiable[]`），同时落 `${SPRINT_DIR}/findings.md` 文件留证：

```json
{"verdict":"PASS","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","findings":[{"severity":"P2","step":"B-01","observation":"保存按钮点击后 3s 才出 toast，页面无 loading 态","evidence":"screenshots/b01-save-toast.png"}], ...}
```

分级分流：`P0/P1`（丢数据/直接面客错误）→ **即使剧本断言全绿也整体 FAIL**（feedback 写明 finding）；`P2/P3` → 只记录不阻塞（report 阶段/人工落 issue）。

**L3 探索层（剧本全过后，带预算自由测试）**：剧本全部 PASS 后，读合同 `## 探索提示` 段执行自由测试——错输入/连点两次/中途刷新/返回重进/边界值，按段内高风险面逐条来，预算默认 **10 分钟/15 动作**（合同段内可调，以合同为准）。发现全部进 `findings[]`，分级分流同上（P0/P1 → FAIL 阻塞 merge）。合同无 `## 探索提示` 段（legacy 合同）→ 跳过 L3，verdict notes 注明"legacy 合同无探索提示段，L3 未执行"。**SEGMENT_EVAL 段级轻验收不跑 L2/L3**（段验维持机械断言，三层只作用于终验/总验——设计如此）。

```json
{"verdict":"PASS","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","verification_level":"L2","behavior_tests":[{"command":"curl -sf localhost:5221/api/brain/ping | jq -e '.ok==true'","exit_code":0,"log_tail":"{\"ok\":true}","verification_level":"L2"}], ...}
```

**verification_level 字段（W3 新增，与 judge #4004 对齐）**：
- 顶层 `verification_level`：本次验收整体达到的等级，缺省 `"L2"`
- 条目级 `behavior_tests[i].verification_level`：每条 behavior_test 的等级，条目级优先于顶层
- 取值：`"L1"`（替身）/ `"L2"`（服务端真验）/ `"L3"`（真机真验）
- judge 读此字段执法：L3 要求 log_tail 含真机指纹关键词（adb shell/UiSelector 等）

示例（PASS）：

```bash
cat > "$RESULT_FILE" << BREOF
{"verdict":"PASS","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":null,"log_excerpt":null,"behavior_tests":[{"command":"<本次真实执行命令>","exit_code":0,"log_tail":"<真实输出末 5 行>"}]}
BREOF
```

示例（FAIL）：

```bash
cat > "$RESULT_FILE" << BREOF
{"verdict":"FAIL","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","failed_step":"task-executor.js 未调用 updateTaskStatus，任务完成后状态未从 in_progress 变为 completed","log_excerpt":"got: in_progress, expected: completed"}
BREOF
```

**禁止**：
- 用 echo 输出 verdict JSON 到 stdout（Brain 不读 stdout）
- 输出摘要/说明文字代替写文件（必须真正写入 "$RESULT_FILE"）

---

## 常见错误

1. **验证命令用 mock 或 dry-run** → 必须连接真实服务（brain 端口 5221，真实 DB）
2. **feedback 笼统** → 必须指明具体文件/函数/值，附修复方向
3. **输出带 markdown 代码块** → Brain 解析 verdict 字段时会失败
4. **E2E 脚本提取不全** → 确认 `contract-draft.md` 的 `## E2E 验收` 区块边界正确（EVA v2 E5 起标题匹配已放宽至 `###`/带空格变体），提取后 `/tmp/e2e-verify.sh`（或 `.ps1`）非空
5. **跳过环境预检直接执行** → 执行前必跑 Step B-1.6（环境预检）/ B-1.8（Golden Path 覆盖）/ B-1.9（Machine Probe）：工具缺失 = `env_missing` FAIL（禁止降级），硬编码路径 = FAIL，Golden Path 有步骤未覆盖 = FAIL


---

## Relay 模式出口 + CANNOT_VERIFY 第三态（T5，harness-controller 派发时生效）

> 入口侧协议见前文「Relay 入口协议」（v1.20）——入口取参 + 红线接回，出口按本段。

**verdict JSON 结构与上面全部流程一字不变**（v1 双轨兼容）。追加两条规则：

### 1. 无法验证 ≠ FAIL（第三态）

某条 [BEHAVIOR] 断言若**无法在当前环境/改动内验证**（断言落在未改文件、依赖未部署的服务、需要跨 sprint 上下文），**禁止臆断 FAIL**——把它记入 verdict JSON 的 `unverifiable` 数组（新增字段，v1 消费方忽略未知字段无害）：

```json
{"verdict":"PASS","task_id":"$TASK_ID","attempt_id":"${HARNESS_ATTEMPT_ID:-}","unverifiable":[{"item":"<断言原文>","reason":"<为何验不了>"}], ...}
```

整体 verdict **只由可验证项决定**。这是治"evaluator 把验不了的东西判 FAIL → generator 无限 fix loop"的结构性修法（对齐 Superpowers 6.0 的 Cannot-verify-from-diff 裁决）。

### 2. RELAY_STATUS 尾行

报告最末尾追加：`RELAY_STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`
- unverifiable 非空 → **必须 DONE_WITH_CONCERNS**（controller 握有跨阶段上下文，负责逐条兜底核对后才放行 merge）
- 环境预检失败无法开跑 → NEEDS_CONTEXT（列缺什么）而非 FAIL
