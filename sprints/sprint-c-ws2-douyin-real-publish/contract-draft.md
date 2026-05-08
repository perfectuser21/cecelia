# Sprint Contract Draft (Round 2)

> **Sprint**: sprint-c-ws2-douyin-real-publish · WS2 修架构 + 抖音 video 真发 + Lead 自验
> **Initiative**: 969f7f8e-4941-4f70-b62d-2a06678f693a
> **Round**: 2（GAN Layer 2a · Proposer 第二轮，对 Round 1 Reviewer REVISION 反馈做修订）
> **journey_type**: agent_remote

---

## Round 2 修订日志（针对 Round 1 Reviewer 反馈）

Round 1 Reviewer 给 REVISION，三条反馈，本轮逐一吸收：

1. **新增 §「失效模式 Mitigation」**：覆盖 Reviewer 提出的 5 类失效场景（含 Lead 转人工扫码重跑、cascade 失败、抖音风控 3 个新增）
2. **WS 严格串行 + Evaluator 两阶段顺序**写入 §E2E 验收：Phase 1 静态校验先于 Phase 2 evidence 校验，路径不一致即整 sprint FAIL，不进 Phase 2
3. **新增 §「Red Demo」段（在 Test Contract 表后）**：列出每份测试文件首个断言行号 + Round 1 复现命令 + 实测 27 failures 分布（WS1 7 / WS2 10 / WS3 10），让 Evaluator 不用揣测就能复现红证据

测试文件、DoD 清单、task-plan.json 在 Round 1 已通过 Reviewer test_is_red ≥ 7 阈值检验，本轮**不修改测试 it() 块也不增删 ARTIFACT 条目**，仅在合同 narrative 层补 Mitigation + Red Demo。

---

## Golden Path

```
[NAS 当日队列就位]
   ↓ (Step 1)
[Mac mini 调度 batch-publish-douyin.sh]
   ↓ (Step 2)
[经 xian-mac 跳板 SCP 文件到 Windows PC]
   ↓ (Step 3)
[Mac mini 经 xian-mac SSH 调起 publish-douyin-video.cjs]
   ↓ (Step 4)
[CDP 19222 连上 Windows Chrome → 上传 / 填表 / 点发布]
   ↓ (Step 5)
[抖音 URL 跳转 creator.douyin.com/content/manage → retrieve 真 item_id]
   ↓ (Step 6)
[Lead ssh xian-pc 走客户视角 7 步 checklist → evidence 文件归档]
```

---

### Step 1: NAS 当日队列就位（trigger）

**可观测行为**: NAS 路径 `creator/output/douyin/2026-05-08/video-1/` 目录存在，含 `title.txt`、`tags.txt`、`video.mp4`，可选 `cover.jpg`；SKILL.md / STATUS.md / FIELDS.md 三份文档对该路径表述一致（不再出现 `~/.douyin-queue/` 这条历史路径）。

**验证命令**:
```bash
# 1. 文档路径一致性（架构对齐）
grep -c "~/.douyin-queue" packages/workflows/skills/douyin-publisher/SKILL.md
# 期望：0

grep -c "creator/output/douyin/" packages/workflows/skills/douyin-publisher/SKILL.md
# 期望：>= 1

# 2. journey.md 存在并指向本 sprint
test -f .agent-knowledge/content-pipeline-douyin/journey.md
grep -q "agent_remote" .agent-knowledge/content-pipeline-douyin/journey.md
grep -q "Content Creator Multi-Platform Publish Journey" .agent-knowledge/content-pipeline-douyin/journey.md

# 3. NAS 队列目录就位（Lead 真跑前先 dry-run 占位即可）
ls "creator/output/douyin/$(date +%Y-%m-%d)/video-1/title.txt" 2>&1 | grep -E "title.txt|No such" | head -1
# 期望：路径字符串出现（无论 exists 或 No such，至少证明命令格式正确）
```

**硬阈值**:
- SKILL.md `~/.douyin-queue` 出现次数 = 0
- SKILL.md `creator/output/douyin/` 出现次数 ≥ 1
- journey.md 存在且含 journey_type=agent_remote
- FIELDS.md 含 video 类型必填字段表 + 退出码 0/1/2 三态定义

---

### Step 2: Mac mini 调度脚本枚举当日队列

**可观测行为**: `bash batch-publish-douyin.sh 2026-05-08` 被触发后，Mac mini 终端 stdout 含枚举到的每个 video-N 子目录路径；空队列时 exit 0 + stdout `no work today`。

**验证命令**:
```bash
# 1. SKILL.md 含批量发布脚本路径明确（哪台机器、哪个绝对路径）
grep -E "batch-publish-douyin\.sh" packages/workflows/skills/douyin-publisher/SKILL.md | head -1
# 期望：行首含路径或 "Mac mini" 描述

# 2. FIELDS.md 退出码表对齐 PRD 边界情况
grep -c "exit 0" packages/workflows/skills/douyin-publisher/FIELDS.md
grep -c "exit 1" packages/workflows/skills/douyin-publisher/FIELDS.md
grep -c "exit 2" packages/workflows/skills/douyin-publisher/FIELDS.md
# 期望：三个 grep 结果都 >= 1
```

**硬阈值**:
- SKILL.md 显式标注 batch-publish-douyin.sh 在 zenithjoy 仓的绝对路径（PRD 决策 v1.2.0）
- FIELDS.md 退出码 0/1/2 完整定义且对齐 PRD 边界情况章节

---

### Step 3: 经 xian-mac 跳板 SCP 文件到 Windows PC（不允许 mock）

**可观测行为**: SCP 完成后，Windows PC `C:\Users\xuxia\douyin-media\2026-05-08\video-1\` 目录含 video.mp4 + 元数据文件，文件大小与 NAS 端一致，且 mtime 在 5 分钟窗口内（防造假）。

**验证命令**:
```bash
# 1. SKILL.md 标明 SCP 跨机链路（Mac mini → xian-mac → Windows）
grep -E "xian-mac.*跳板|SCP.*xian|跳板.*SCP" packages/workflows/skills/douyin-publisher/SKILL.md | head -1
# 期望：有匹配（说明文档中明确了 SCP 经跳板这条事实）

# 2. Lead 自验 evidence 文件中含 SCP 真 stdout 摘录（步骤 4 ssh xian-pc ls 输出）
test -f .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md
grep -E "C:\\\\Users\\\\xuxia\\\\douyin-media|C:/Users/xuxia/douyin-media|xuxia.douyin-media" \
  .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md | head -1
# 期望：evidence 含 Windows 路径出现（说明 Lead 真跑过 ssh xian-pc 看文件）

# 3. evidence 文件 mtime 在 sprint 周期内（防止用旧 evidence 假装通过）
EVIDENCE_MTIME=$(stat -c %Y .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md 2>/dev/null || stat -f %m .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md)
SPRINT_START=$(date -d "2026-05-08" +%s 2>/dev/null || date -j -f "%Y-%m-%d" "2026-05-08" +%s)
[ "$EVIDENCE_MTIME" -ge "$SPRINT_START" ] && echo "evidence_within_sprint" || echo "evidence_too_old"
# 期望：evidence_within_sprint
```

**硬阈值**:
- evidence 文件存在且 mtime ≥ 2026-05-08（sprint 启动日）
- evidence 含 Windows 路径字面量（证明 Lead 真 ssh xian-pc 跑过 ls）
- SKILL.md 显式描述跳板架构（Mac mini → xian-mac → Windows，不绕过）

---

### Step 4: 经 xian-mac SSH 调起 publish-douyin-video.cjs（不允许 mock CDP）

**可观测行为**: Lead 在 Mac mini 终端跑 `bash batch-publish-douyin.sh $(date +%Y-%m-%d)` 后，stdout 含真 SSH 调用日志（如 `Connected to xuxia@100.97.242.124`），脚本非本地 fake，是真跑在 Windows PC 上。

**验证命令**:
```bash
# 1. evidence 含 Lead checklist 步骤 2 的真 curl 输出（CDP 19222 端口探活）
grep -E "19222|/json|webSocketDebuggerUrl" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md | head -3
# 期望：≥ 1 行匹配（证明 Lead 真跑了 curl http://localhost:19222/json）

# 2. evidence 含 Lead checklist 步骤 3 的 Mac mini 真 stdout 摘录
grep -E "batch-publish-douyin\.sh|publish-douyin-video\.cjs|Connected to" \
  .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md | head -3
# 期望：≥ 1 行匹配

# 3. E2E smoke 测试存在且每步有显式 step 标记
test -f tests/content-pipeline-douyin-e2e.test.js
grep -cE "step[_ ]?[3-5]|Step [3-5]" tests/content-pipeline-douyin-e2e.test.js
# 期望：>= 3（Step 3/4/5 各至少 1 个标记，失败时能定位挂在哪一步）
```

**硬阈值**:
- evidence 含 19222 / CDP 探活真输出
- evidence 含 Mac mini 真触发命令的 stdout
- tests/content-pipeline-douyin-e2e.test.js 含 ≥ 3 个 step 显式标记（Step 3/4/5）

---

### Step 5: CDP 19222 自动化上传 / 填表 / 点发布

**可观测行为**: Windows Chrome 抖音页面被 Playwright 真控制，evidence 含截图 ≥ 3 张（PRD checklist 步骤 5/6/7 对应：上传中、跳转 manage、Lead App 主页可见）。

**验证命令**:
```bash
# 1. evidence 含截图引用（markdown image syntax）
grep -cE "!\[.*\]\(.*\.(png|jpg|jpeg|gif)\)" \
  .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md
# 期望：>= 3（至少 3 张截图）

# 2. 截图文件真实存在（不是 markdown 中的占位 URL）
SCREENSHOTS=$(grep -oE "\(\.\/screenshots\/[^)]+\)" \
  .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md | tr -d '()')
COUNT=0
for s in $SCREENSHOTS; do
  test -f ".agent-knowledge/content-pipeline-douyin/${s#./}" && COUNT=$((COUNT + 1))
done
[ "$COUNT" -ge 3 ] && echo "screenshots_present" || echo "screenshots_missing"
# 期望：screenshots_present

# 3. 截图文件 mtime 在 sprint 周期内（防止重用历史截图）
for s in $SCREENSHOTS; do
  FILE_PATH=".agent-knowledge/content-pipeline-douyin/${s#./}"
  test -f "$FILE_PATH" || continue
  MTIME=$(stat -c %Y "$FILE_PATH" 2>/dev/null || stat -f %m "$FILE_PATH")
  SPRINT_START=$(date -d "2026-05-08" +%s 2>/dev/null || date -j -f "%Y-%m-%d" "2026-05-08" +%s)
  [ "$MTIME" -ge "$SPRINT_START" ] || { echo "screenshot_too_old: $s"; exit 1; }
done
echo "all_screenshots_fresh"
# 期望：all_screenshots_fresh
```

**硬阈值**:
- evidence 引用 ≥ 3 张截图，且截图文件真实存在于 .agent-knowledge/content-pipeline-douyin/screenshots/
- 每张截图 mtime ≥ 2026-05-08

---

### Step 6: 抖音返回真 item_id 且回写到 STATUS.md

**可观测行为**: STATUS.md 中视频发布的 item_id 字段更新为本次新发的 ID（19 位数字字符串），**不能是历史值 7605861760767233306**；evidence 文件含同一个 item_id 字符串；条目含 Lead 签名行。

**验证命令**:
```bash
# 1. STATUS.md 含本次真 item_id（19 位数字，且不是历史值）
NEW_ITEM_ID=$(grep -oE "ItemId.*[0-9]{19}|item_id.*[0-9]{19}" packages/workflows/skills/douyin-publisher/STATUS.md | grep -oE "[0-9]{19}" | grep -v "^7605861760767233306$" | head -1)
[ -n "$NEW_ITEM_ID" ] && echo "new_item_id=$NEW_ITEM_ID" || { echo "FAIL: 没有找到本次新 item_id"; exit 1; }
# 期望：new_item_id=<19 位数字>，且不等于 7605861760767233306

# 2. evidence 文件含同一个 item_id（一致性）
grep -q "$NEW_ITEM_ID" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md \
  && echo "evidence_consistent" || { echo "FAIL: evidence 中无对应 item_id"; exit 1; }

# 3. evidence 含 Lead 签名行（铁律 7：必须主理人本人签字）
grep -E "Cecelia.*2026-05-0[0-9].*自验通过|Cecelia.*自验通过.*2026-05-0[0-9]" \
  .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md | head -1
# 期望：≥ 1 行匹配

# 4. STATUS.md 历史 item_id 7605861760767233306 必须有"历史值"或"已废弃"标注（防止误用）
grep -B1 -A1 "7605861760767233306" packages/workflows/skills/douyin-publisher/STATUS.md | grep -iE "历史|旧|废弃|已替换|deprecated|legacy" | head -1
# 期望：≥ 1 行匹配（说明历史 ID 已被显式标注，不会和新 ID 混淆）
```

**硬阈值**:
- STATUS.md 含本次新 item_id（19 位数字 ≠ 7605861760767233306）
- evidence 含同一 item_id（一致性证据）
- evidence 含 Lead 签名行（"Cecelia, 2026-05-0X, 自验通过"）
- STATUS.md 历史 item_id 7605861760767233306 含"历史/旧/废弃"显式标注

---

## 失效模式 Mitigation（Round 2 新增 — 回应 Reviewer 5 类挑战）

> Reviewer Round 1 列出 5 类失效场景；下面逐一给 Mitigation 写进合同，Generator 实现时按此规则处理，Evaluator 按此判定 sprint 状态。

### M1：抖音 web 端 UI 改版（XPath 失效）

- **触发条件**：publish-douyin-video.cjs 跑到上传步骤，Playwright 选择器超时报错（`/html/body/div[1]/...` 不再命中）
- **Mitigation**：脚本 exit 2 + stderr `XPath stale, schedule hotfix sprint`；Mac mini scheduler 不重试；evidence 文件标记 `failure-type: ui-changed` 并开新 hotfix sprint，**不算本 sprint failure**（PRD ASSUMPTION 已声明 UI 大改触发独立 hotfix）
- **本 sprint 落点**：FIELDS.md 退出码表 `exit 2 = UI selector stale / login expired / CDP unreachable` 三态合并

### M2：抖音登录会话失效，需 Lead 转人工扫码后重跑

- **触发条件**：脚本检测到 URL 含 `/login` 或 Playwright 跳到登录页
- **Mitigation**：
  1. 脚本 exit 2 + stderr `Session expired, manual scan needed`，**不重试**
  2. Lead 在 Windows PC 浏览器手动扫码登录，Chrome session 持久化到 `--user-data-dir`（已配置）
  3. Lead 重跑 `bash batch-publish-douyin.sh $(date +%Y-%m-%d)`
  4. evidence 文件追加 `## 重跑记录` 区块，含两段 stdout：第一次 exit 2 + 第二次成功 retrieve item_id；最终 item_id 仍以第二次为准
- **不算 failure**：第一次 exit 2 后第二次成功 = 本 sprint PASS（evidence 含两段 stdout 即视为 Lead 完整经历过该 mitigation 路径，证明流程可恢复）
- **算 failure**：第二次仍 exit 2，且 24h 内未恢复 → 标记 `deferred-by-session-expiry`，按 M5 规则处理（视同平台风险延期）

### M3：CDP 端口 19222 连不上 Windows Chrome

- **触发条件**：`curl http://localhost:19222/json` 返回非 JSON 或 timeout
- **Mitigation**：
  1. 脚本 exit 2 + stderr `CDP unreachable`
  2. Lead ssh 到 xian-mac 跑 `schtasks /run /tn StartAllBrowsers` 重启 Chrome 实例
  3. 等 30s 后 Lead 重跑 batch-publish-douyin.sh
  4. evidence 追加 `## CDP 恢复记录`，含 schtasks 命令 stdout + 重跑 stdout
- **不算 failure**：恢复后成功 = PASS

### M4：Cascade 失败（WS1 文档对齐错 → WS2 模板基于错误路径 → WS3 evidence 引用不存在路径）

- **触发条件**：WS 间无强串行约束，平行实现可能导致 WS2/WS3 引用 WS1 尚未对齐的字段
- **Mitigation**（合同强约束 — Generator 实现 + Evaluator 判定双侧落地）：
  1. **task-plan.json 中 ws2 `depends_on: ["ws1"]`、ws3 `depends_on: ["ws2"]`** —— Generator 严格串行实现，**禁止并行起 worktree**
  2. **WS1 测试红 → 不进 WS2**：Generator 完成 WS1 后必须先跑 `npx vitest run sprints/sprint-c-ws2-douyin-real-publish/tests/ws1` 全绿才能开 WS2 commit；否则 abort
  3. **Evaluator 两阶段顺序硬约束**（已写进 §E2E 验收）：
     - **Phase 1 静态校验**（仅依赖 WS1 产物）：SKILL.md 路径 / FIELDS.md 退出码 / journey.md 存在
     - **Phase 1 任一项 FAIL → 整 sprint FAIL，不进 Phase 2**（不浪费 evidence 校验时间，且避免 evidence 文件指向错误路径却被误判通过）
     - **Phase 2 evidence 校验**（依赖 WS2/WS3 产物）：仅在 Phase 1 全 PASS 后执行
- **本 sprint 落点**：§E2E 验收脚本里 `Phase 1` 在 `Phase 2` 之前；任一 Phase 1 step FAIL 立即 `exit 1`

### M5：抖音真账号当天被风控/封禁

- **触发条件**：Lead 自验时打开抖音 App 主页，发现账号被限流 / 封禁 / 不能发视频
- **Mitigation**：
  1. **自验前 pre-check**：Lead 在自己手机抖音 App 打开本账号主页，确认能正常浏览 + 上一条视频未被下架（PRD checklist 新增第 0 步）
  2. 若 pre-check 失败 → **不进入 Mac mini 触发步骤**（避免 sprint 一半被风控，evidence 半截）
  3. evidence 文件填入 `## 平台风险延期声明` 区块，含：
     - `failure-type: deferred-by-platform-risk`
     - 风控发现的具体表现（限流提示截图 / 封禁通知截图）
     - 改约日期（推下日重做）
     - Lead 签名 `Cecelia, 2026-05-0X, 因平台风险延期，非本 sprint 工程缺陷`
  4. **不算本 sprint failure** —— Evaluator 看到 `deferred-by-platform-risk` 标记 + 完整 pre-check 截图 + Lead 签名 = sprint 标 `DEFERRED`（不是 FAIL，不是 APPROVED）
- **DEFERRED ≠ APPROVED**：sprint 状态留待平台风险解除后改约重跑；harness 总轮次不浪费

### M6（兜底）：所有非 M1-M5 的工程失败

- **判定**：Generator 实现挂、测试本来全绿但 evidence 校验某条 FAIL、Lead 走 checklist 中途遇到非 M2/M3 类型异常
- **Mitigation**：正常 GAN 修订流程 — Reviewer REVISION → Proposer 改 → Reviewer 重审；不属于本 §Mitigation 表覆盖范围

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: `agent_remote`

**验证策略**：因为 journey 跨 3 台机器（Mac mini → xian-mac → Windows PC），CI 容器内不可能真跑 SSH/SCP/CDP 链路；E2E 验收 = 检查 evidence 文件能否证明 Lead 真跑过 + smoke 测试脚本结构正确。**禁止在 smoke 内 mock SCP/CDP**——若 Evaluator 发现 smoke 内含 `jest.mock('child_process')` 或 `playwright.mock` 即 FAIL。

**两阶段顺序硬约束**（Round 2 新增 — 来自 Mitigation M4）：
- **Phase 1 静态校验**（WS1 产物）必须**全部** PASS 才进入 Phase 2
- 任一 Phase 1 step FAIL → 立即 `exit 1`，整 sprint FAIL，不浪费 evidence 校验时间

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# === Phase 1: 静态结构验证（CI 可跑 / WS1 产物 / 路径一致性是 cascade 防火墙）===

# 1.1 三份文档路径一致性（PRD Feature 1）
[ "$(grep -c "~/.douyin-queue" packages/workflows/skills/douyin-publisher/SKILL.md)" = "0" ] \
  || { echo "FAIL[Phase1.1]: SKILL.md 还含历史路径 ~/.douyin-queue（cascade 防火墙触发，不进 Phase2）"; exit 1; }
grep -q "creator/output/douyin/" packages/workflows/skills/douyin-publisher/SKILL.md \
  || { echo "FAIL[Phase1.1]: SKILL.md 缺统一 NAS 路径（cascade 防火墙触发，不进 Phase2）"; exit 1; }

# 1.2 FIELDS.md 退出码 0/1/2 完整
for code in "exit 0" "exit 1" "exit 2"; do
  grep -q "$code" packages/workflows/skills/douyin-publisher/FIELDS.md \
    || { echo "FAIL[Phase1.2]: FIELDS.md 缺 $code 定义（cascade 防火墙触发，不进 Phase2）"; exit 1; }
done

# 1.3 journey.md 存在
test -f .agent-knowledge/content-pipeline-douyin/journey.md \
  || { echo "FAIL[Phase1.3]: journey.md 不存在（cascade 防火墙触发，不进 Phase2）"; exit 1; }
grep -q "agent_remote" .agent-knowledge/content-pipeline-douyin/journey.md \
  || { echo "FAIL[Phase1.3]: journey.md 缺 journey_type=agent_remote（cascade 防火墙触发，不进 Phase2）"; exit 1; }

# 1.4 E2E smoke 测试结构（含 ≥ 3 个 step 显式标记，且无 mock SCP/CDP）
test -f tests/content-pipeline-douyin-e2e.test.js \
  || { echo "FAIL[Phase1.4]: E2E smoke 文件缺失"; exit 1; }
STEP_COUNT=$(grep -cE "step[_ ]?[1-7]|Step [1-7]" tests/content-pipeline-douyin-e2e.test.js)
[ "$STEP_COUNT" -ge 5 ] || { echo "FAIL[Phase1.4]: E2E smoke step 标记不足（$STEP_COUNT < 5）"; exit 1; }
if grep -qE "jest\.mock.*child_process|jest\.mock.*ssh|playwright.*mock|mockImplementation.*scp" tests/content-pipeline-douyin-e2e.test.js; then
  echo "FAIL[Phase1.4]: E2E smoke 内含 mock SCP/CDP，违反 PRD 真链路要求"
  exit 1
fi

echo "✅ Phase 1 静态校验通过 — 进入 Phase 2 evidence 校验"

# === Phase 2: Lead 自验 evidence 验证（必须主理人本人填 / WS2+WS3 产物）===

EVIDENCE=.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md

# 2.0 平台风险延期早期检测（M5 — 命中即标 DEFERRED 而非 FAIL）
if grep -q "deferred-by-platform-risk" "$EVIDENCE" 2>/dev/null; then
  grep -qE "Cecelia.*2026-05-0[0-9].*因平台风险延期" "$EVIDENCE" \
    || { echo "FAIL[Phase2.0]: 标记 deferred-by-platform-risk 但缺 Lead 签名 / 改约说明"; exit 1; }
  echo "⚠️ DEFERRED: sprint 因抖音平台风险延期（M5），非工程 failure，待改约重跑"
  exit 2  # 约定 exit code 2 = DEFERRED，与 FAIL(1) / PASS(0) 区分
fi

test -f "$EVIDENCE" || { echo "FAIL[Phase2.1]: Lead 自验 evidence 文件缺失"; exit 1; }

# 2.1 evidence mtime ≥ sprint 启动日（不允许重用旧 evidence）
EVIDENCE_MTIME=$(stat -c %Y "$EVIDENCE" 2>/dev/null || stat -f %m "$EVIDENCE")
SPRINT_START=$(date -d "2026-05-08" +%s 2>/dev/null || date -j -f "%Y-%m-%d" "2026-05-08" +%s)
[ "$EVIDENCE_MTIME" -ge "$SPRINT_START" ] \
  || { echo "FAIL[Phase2.1]: evidence mtime 早于 sprint 启动日，疑似重用"; exit 1; }

# 2.2 evidence 含 Lead 签名
grep -qE "Cecelia.*2026-05-0[0-9].*自验通过|Cecelia.*自验通过.*2026-05-0[0-9]" "$EVIDENCE" \
  || { echo "FAIL[Phase2.2]: evidence 缺 Lead 签名行"; exit 1; }

# 2.3 evidence 含 cmd stdout（Lead 真跑过 curl + ssh）
grep -qE "19222|webSocketDebuggerUrl|/json" "$EVIDENCE" \
  || { echo "FAIL[Phase2.3]: evidence 缺 CDP 19222 探活输出"; exit 1; }
grep -qE "C:\\\\Users\\\\xuxia|C:/Users/xuxia|xuxia.douyin-media" "$EVIDENCE" \
  || { echo "FAIL[Phase2.3]: evidence 缺 Windows 路径（疑似没真 ssh xian-pc）"; exit 1; }

# 2.4 evidence 含 ≥ 3 张截图，且每张截图文件真实存在 + mtime 在 sprint 内
SCREENSHOT_REFS=$(grep -oE "\(\.\/screenshots\/[^)]+\)" "$EVIDENCE" | tr -d '()')
[ "$(echo "$SCREENSHOT_REFS" | wc -l)" -ge 3 ] \
  || { echo "FAIL[Phase2.4]: evidence 截图引用 < 3"; exit 1; }
for ref in $SCREENSHOT_REFS; do
  FILE_PATH=".agent-knowledge/content-pipeline-douyin/${ref#./}"
  test -f "$FILE_PATH" || { echo "FAIL[Phase2.4]: 截图 $ref 文件不存在"; exit 1; }
  MTIME=$(stat -c %Y "$FILE_PATH" 2>/dev/null || stat -f %m "$FILE_PATH")
  [ "$MTIME" -ge "$SPRINT_START" ] || { echo "FAIL[Phase2.4]: 截图 $ref mtime 早于 sprint"; exit 1; }
done

# 2.5 真 item_id 校验（≠ 7605861760767233306 历史值）
NEW_ITEM_ID=$(grep -oE "[0-9]{19}" packages/workflows/skills/douyin-publisher/STATUS.md \
  | grep -v "^7605861760767233306$" \
  | grep -v "^7605837846758313266$" \
  | head -1)
[ -n "$NEW_ITEM_ID" ] || { echo "FAIL[Phase2.5]: STATUS.md 没有本次新 item_id"; exit 1; }
grep -q "$NEW_ITEM_ID" "$EVIDENCE" \
  || { echo "FAIL[Phase2.5]: evidence 中无 STATUS.md 同一 item_id（一致性失败）"; exit 1; }

echo "✅ Golden Path 验证通过 (新 item_id=$NEW_ITEM_ID, 截图齐全, Lead 已签名)"
```

**通过标准**:
- exit 0 = sprint APPROVED（PASS）
- exit 1 = sprint FAIL（工程缺陷）
- exit 2 = sprint DEFERRED（M5 平台风险延期，非工程 failure）

---

## Workstreams

workstream_count: 3
**WS 严格串行**（M4 cascade 防火墙）：ws1 → ws2 → ws3，禁止并行 worktree。

### Workstream 1: 三份文档对齐 + journey.md（Feature 1）

**范围**:
- 改 `packages/workflows/skills/douyin-publisher/SKILL.md`：删除 `~/.douyin-queue` 历史路径，统一为 `creator/output/douyin/{date}/`；显式标注 SCP 跨机跳板架构；增加 Lead 自验章节链接
- 改 `packages/workflows/skills/douyin-publisher/FIELDS.md`：补全 video 类型必填字段表（title/tags/video.mp4/cover）+ 退出码 0/1/2 三态完整定义
- 新建 `.agent-knowledge/content-pipeline-douyin/journey.md`：含 Journey 名称 / journey_type=agent_remote / 8 步定义 / 当前 Maturity

**大小**: S（< 100 行新增/修改）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/sprint-c-ws2-douyin-real-publish/tests/ws1/docs-alignment.test.ts`

**串行 Gate**: 完成后跑 `npx vitest run sprints/sprint-c-ws2-douyin-real-publish/tests/ws1` 全绿才进 ws2（M4）

---

### Workstream 2: Lead 自验机制工程化 + E2E smoke 脚手架（Feature 0 + Feature 3）

**范围**:
- 新建 `.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md`：含 7 步 checklist + cmd stdout 占位 + 截图引用占位（`./screenshots/step-5-upload.png` 等 ≥ 3 个）+ Lead 签名占位 + item_id 占位
- 新建 `.agent-knowledge/content-pipeline-douyin/screenshots/.gitkeep`：截图归档目录
- 新建 `tests/content-pipeline-douyin-e2e.test.js`：含 7 个 Step 显式 `describe('Step N')` 块，每步含真链路占位（绝不 mock SCP/CDP），失败时打印挂在哪一步

**大小**: M（100-300 行）
**依赖**: WS1 完成后

**BEHAVIOR 覆盖测试文件**: `sprints/sprint-c-ws2-douyin-real-publish/tests/ws2/lead-acceptance-template.test.ts`

**串行 Gate**: 完成后跑 `npx vitest run sprints/sprint-c-ws2-douyin-real-publish/tests/ws1 sprints/sprint-c-ws2-douyin-real-publish/tests/ws2` 全绿才进 ws3（M4）

---

### Workstream 3: 真发执行 + 证据回写 STATUS.md（Feature 2）

**范围**:
- Lead 走完 PRD checklist 第 0 步（M5 pre-check 抖音账号正常）+ 7 步主流程，把真 cmd stdout / 截图 / 新 item_id / 签名填回 `lead-acceptance-sprint-2.1a.md`
- 改 `packages/workflows/skills/douyin-publisher/STATUS.md`：把视频发布条目的 item_id 更新为本次真发的 ID（≠ 7605861760767233306），并显式给历史 ID 加"历史值/已替换"标注
- 截图文件 ≥ 3 张落 `.agent-knowledge/content-pipeline-douyin/screenshots/`
- 若遇 M2（session 失效需重扫）→ evidence 追加 `## 重跑记录`；若遇 M5（账号风控）→ evidence 填 `## 平台风险延期声明` + `deferred-by-platform-risk` 标记

**大小**: M（涉及真账号操作 + 文档回写）
**依赖**: WS1 + WS2 完成后

**BEHAVIOR 覆盖测试文件**: `sprints/sprint-c-ws2-douyin-real-publish/tests/ws3/real-publish-evidence.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（Round 1 baseline 实测） |
|---|---|---|---|
| WS1 | `tests/ws1/docs-alignment.test.ts` | 解析 SKILL.md NAS 路径 = `creator/output/douyin/`；解析 FIELDS.md 退出码表完整；journey.md 解析 journey_type | **WS1 → 7 failures**（路径未对齐 / 历史路径仍在 / FIELDS.md video 必填字段缺 / FIELDS.md 退出码缺 / journey.md 不存在 / journey.md 缺 agent_remote / journey.md 缺 8 步定义）；1 passed（SKILL.md 跳板字样已存在）|
| WS2 | `tests/ws2/lead-acceptance-template.test.ts` | 解析 lead-acceptance 模板必含 7 个 checklist 步骤、3 个截图占位、Lead 签名行模板；解析 E2E smoke 含 ≥ 5 个 Step 标记且不含 mock SCP/CDP | **WS2 → 10 failures**（evidence 模板缺 / 截图占位缺 / 签名占位缺 / item_id 占位缺 / screenshots 目录缺 / E2E smoke 缺 / step 标记缺 / 5 类 mock 检查全失败 — 因为文件根本不存在 readFileSync 抛 ENOENT）|
| WS3 | `tests/ws3/real-publish-evidence.test.ts` | 解析 STATUS.md 提取本次 item_id ≠ 7605861760767233306 且 = 19 位数字；解析 evidence 含同一 item_id；evidence 含 Lead 签名 + cmd stdout + ≥ 3 张截图实文件 | **WS3 → 10 failures**（STATUS.md 无新 item_id / 历史 ID 无标注 / evidence 一致性失败 / 签名缺 / 19222 探活缺 / Mac mini stdout 缺 / Windows 路径缺 / screenshots 目录不存在 / 截图 mtime 检查失败 / evidence mtime 检查失败）|

**总红证据（Round 1 baseline）**：27 failures（WS1 7 / WS2 10 / WS3 10）+ 1 passed = 28 tests

---

## Red Demo（Round 2 新增 — 让 Evaluator 不用揣测就能复现红证据）

### 复现命令

```bash
git checkout cp-harness-propose-r1-969f7f8e  # 或 r2 同样能复现，因测试文件 Round 1=Round 2 等价
npx vitest run sprints/sprint-c-ws2-douyin-real-publish/tests --reporter=verbose
# 期望：exit=1，27 failed | 1 passed (28)
```

### 每份测试文件首个断言行号 + 实测红状态

| Test File | First Assertion | Round 1 实测红状态 |
|---|---|---|
| `tests/ws1/docs-alignment.test.ts:14` | `expect(matches.length).toBe(0)` —— 期望 SKILL.md 中 `~/.douyin-queue` 出现 0 次 | **FAIL**：SKILL.md 当前出现 4 次（`grep -c "~/.douyin-queue" SKILL.md` = 4），断言 `Expected: 0, Received: 4` |
| `tests/ws1/docs-alignment.test.ts:19` | `expect(content).toMatch(/creator\/output\/douyin\//)` | **FAIL**：SKILL.md 不含 `creator/output/douyin/` 字符串（`grep -c` = 0），断言 `Expected to match, did not match` |
| `tests/ws1/docs-alignment.test.ts:34` | `expect(content).toContain('title.txt')` —— FIELDS.md 含 video 必填字段 | **FAIL**：FIELDS.md 不含 `title.txt`（同样不含 `video.mp4`、`exit 0/1/2`） |
| `tests/ws1/docs-alignment.test.ts:46` | `expect(existsSync(JOURNEY_MD)).toBe(true)` —— `.agent-knowledge/content-pipeline-douyin/journey.md` 存在 | **FAIL**：`.agent-knowledge/` 当前根本没有 `content-pipeline-douyin/` 子目录（ENOENT），后续 readFileSync 也都因 ENOENT 抛错 |
| `tests/ws2/lead-acceptance-template.test.ts:12` | `expect(existsSync(EVIDENCE)).toBe(true)` —— evidence 模板文件存在 | **FAIL**：`.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md` 不存在；后续 9 个 it() 全部因 readFileSync ENOENT 失败 |
| `tests/ws2/lead-acceptance-template.test.ts:43` | `expect(existsSync(SCREENSHOTS_DIR)).toBe(true)` | **FAIL**：screenshots 目录不存在 |
| `tests/ws2/lead-acceptance-template.test.ts:48` | `expect(existsSync(E2E_SMOKE)).toBe(true)` | **FAIL**：`tests/content-pipeline-douyin-e2e.test.js` 不存在（仓库根 tests/ 目录里没有该文件）|
| `tests/ws3/real-publish-evidence.test.ts:22` | `expect(fresh.length).toBeGreaterThanOrEqual(1)` —— STATUS.md 含 ≠ 历史值的新 item_id | **FAIL**：STATUS.md 当前只有历史 ID 7605861760767233306 + 7605837846758313266，无新值 |
| `tests/ws3/real-publish-evidence.test.ts:30` | `expect(idx).toBeGreaterThanOrEqual(0)` —— STATUS.md 含历史 ID 行 + 后续 toMatch(/历史\|旧值\|.../) | **FAIL**：找到历史 ID 行但前后 2 行内无"历史/旧值/废弃/已替换"标注，第二个 expect 失败 |
| `tests/ws3/real-publish-evidence.test.ts:69` | `expect(files.length).toBeGreaterThanOrEqual(3)` —— screenshots/ 含 ≥ 3 张图 | **FAIL**：screenshots 目录不存在，readdirSync 抛 ENOENT |

### 唯一通过的测试

```
✓ tests/ws1/docs-alignment.test.ts:22-30
  > "SKILL.md 显式描述 SCP 跨机跳板架构（含 xian-mac 跳板字样）"
  原因：当前 SKILL.md 已含 "xian-mac" 字样描述跳板架构（这是 Round 1 之前就存在的内容），所以这条 1 个 pass 不算我们 commit 的功劳，只是历史文档的 happy accident
```

### Round 1 vs Reviewer 反馈数字对账

- Reviewer 反馈写 "15 failures（4+5+6）" —— 这是 Reviewer 估算或基于早期分桶；实测 Round 1 commit 后真实数字是 **27 failures（7+10+10）**
- 偏差原因：每个 it() 块内多个 expect 中只要任一 throw 就计 1 个 failure；模板缺失导致 `readFileSync` 直接 ENOENT，整个 it() 块 fail，但 vitest 是 per-it 计数 1 次而非 per-expect
- 本轮 Test Contract 表已用实测数字（7/10/10）替换估算（4/5/6），test_is_red = 27 远超阈值 7

---

## Reviewer 必挑战项（PRD Feature 0 列出 + Proposer 自查）

1. **smoke 真的从 Step 1 跑到 Step 7？** ✅ E2E 脚本含 ≥ 5 个 Step 显式 `describe` 块；Evaluator Phase 1.4 强校验
2. **任一中间 step 真链路（不是 mock）？** ✅ E2E 脚本扫描 `jest.mock|mockImplementation` 关键字 → 命中即 FAIL
3. **失败时是否有清晰的 step 标记？** ✅ 每个 Step 独立 `describe` 块，jest 输出含 step 编号；Phase 1/2 错误信息含 `[PhaseX.Y]` 前缀
4. **smoke 跑完后 NAS 当日队列是否被标记 status=published？** [ASSUMPTION: 本 sprint 不强求 NAS 队列状态机回写，留下 sprint Step 8] — Reviewer 可挑战这个 scope 切割
5. **验证命令能否造假通过？** Proposer 自查：
   - 截图 mtime 强校验 ≥ sprint 启动日（不能重用旧截图）
   - item_id 强校验 ≠ 历史值 7605861760767233306（不能复制粘贴 STATUS.md 旧值）
   - evidence mtime 强校验 ≥ sprint 启动日（不能重用旧 evidence 文件）
   - 跨文件一致性强校验（STATUS.md item_id == evidence item_id）
   - Lead 签名正则严格匹配 `Cecelia.*2026-05-0[0-9].*自验通过`
   - **M5 deferred 标记必须配合 Lead 真签名 + 风控截图**，不能空标 deferred 蒙混
6. **Cascade 防火墙是否真有效？** ✅ Phase 1 静态校验任一 FAIL 立即 exit 1，evidence 校验绝不会 mask 路径错误（M4）
7. **Lead 自验流程能否在异常路径下恢复？** ✅ M2/M3 给了显式 mitigation 路径 + evidence 重跑记录区块要求

## 范围外（PRD 显式声明，Reviewer 不应挑战）

- 抖音 image / article 真发（已在 STATUS.md 标"成功"）
- Brain 回写 dev-records（PRD Step 8）
- Windows Chrome 实例自启（schtasks 已存在）
- 把 zenithjoy 仓脚本搬到 cecelia 仓（PRD v1.2.0 决策保留）
- 抖音账号被封禁后的运营恢复策略（M5 标 DEFERRED 即终止本 sprint，运营动作不在工程范围）
