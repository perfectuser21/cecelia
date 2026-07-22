# Sprint Contract Draft (Round 1)

锚定父路声明：独立小路（无父路）— 本 sprint 是一次针对 `scripts/quickcheck.sh` 既有行为的机械修复（fire-drill），不覆盖任何已登记的 Golden Path。

## 技术上下文推导（Step 1.1 / 1.3）

- api_registry / db_registry / test_registry：本任务不涉及 HTTP 端点、DB schema 变更，跳过 API/DB 字段推导；test_registry 未用于本任务（shell 脚本非 JS 可导入模块）。
- context-manifest（`GET /api/brain/line/5f94aa5b-516b-4a87-97aa-8aa820616793/context-manifest`）：`context-manifest: unavailable`（HTTP 404）。PRD 已声明本 line 累积 FR 为空，与此一致，无冲突。
- 已知约束来源：`packages/engine/tests/scripts/quickcheck-mutex.test.ts`（互斥锁行为，本次不改动）；`packages/engine/hooks/pre-push.sh`（quickcheck.sh 的唯一调用方，本次不改动其调用方式）。

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本任务修复的是本地 CLI 脚本 `scripts/quickcheck.sh` 的 stdout 文本分类逻辑与进程退出码，不涉及任何 HTTP 端点。`## Response Schema` 段落 N/A。

## 已知约束（来自回归测试 / 累积FR）

- [回归测试] `packages/engine/tests/scripts/quickcheck-mutex.test.ts` → "两次并发调用，只有一个真正跑完，另一个跳过"；本次修复不得破坏该互斥锁行为
- [回归测试] `packages/engine/tests/scripts/quickcheck-mutex.test.ts` → "锁在脚本结束后自动释放（下一次能正常跑）"
- [累积FR] context-manifest: unavailable（journey 5f94aa5b-516b-4a87-97aa-8aa820616793 无历史累积 FR，PRD 已确认为空，一致）

## 根因定位（供 Generator 参考，非合同强制实现细节）

现有分类逻辑（`scripts/quickcheck.sh`）：

```bash
if [[ $VITEST_EXIT -eq 0 ]]; then
  echo "✅ 通过"
elif echo "$VITEST_OUT" | grep -q " FAIL "; then
  echo "❌ 失败"; PASS=false
else
  echo "⚠️ Worker 异常退出（OOM？），但无测试失败 — 继续"
fi
```

`grep -q " FAIL "` 只匹配 vitest 逐文件失败标记（如 ` FAIL  path/to/file.test.ts`）。当 worker 在打印逐文件标记前发生 OOM 崩溃时，vitest 仍可能在汇总行打印形如 `Tests  N failed | M passed` 的失败计数，但不含字面 ` FAIL ` 标记 —— 此时现有 `elif` 分支不命中，逻辑落入 `else` 分支，被误判为"仅 OOM 无失败"而放行（exit 0）。真实失败被吞掉。

修复方向（Generator 决定具体实现）：分类判断必须在 OOM 宽免之前，优先检测汇总行是否存在失败计数（如匹配 `Tests\s+[1-9][0-9]*\s+failed` 一类模式），只有真正零失败时才进入 OOM 宽免分支。

## Golden Path

[开发者执行 quickcheck / pre-push 触发] → [脚本对每个改动包运行 vitest，捕获合并输出与退出码] → [判定该包是否存在明确失败计数] → [汇总所有改动包判定结果] → [以正确的整体退出码结束]

### Step 1: 开发者触发 quickcheck 对改动包运行 vitest
**来源**: `[FROM_PRD]` — Golden Path 步骤 1-2："开发者本地执行 quickcheck...脚本对每个改动包运行一次 vitest"

**可观测行为**: 对每个命中 `packages/engine|packages/brain|apps/api|apps/dashboard` 变更前缀的包，脚本调用一次 vitest 子进程并捕获其合并 stdout+stderr 与退出码

**验证命令**:
```bash
bash -n scripts/quickcheck.sh || { echo "FAIL: 脚本语法错误"; exit 1; }
grep -q 'vitest run' scripts/quickcheck.sh && echo OK
```

**硬阈值**: 脚本语法合法且仍对每个改动包调用 `vitest run`

---

### Step 2: 明确失败计数优先于 OOM 宽免判定为失败
**来源**: `[FROM_PRD]` — Golden Path 步骤 3："若输出中存在明确的测试失败计数（不论是否同时出现 worker unexpected exit / OOM 相关文案），quickcheck 判定该包为失败"

**可观测行为**: 构造"失败计数 + OOM 文案同现"的 vitest 输出 fixture 时，quickcheck 对该包判定为失败，整体退出码非 0

**验证命令**:
```bash
# 见 ## E2E 验收 区块完整脚本；此处为语义定位，实际断言由 vitest 测试
node -e "const c=require('fs').readFileSync('packages/engine/tests/scripts/quickcheck-oom-priority.test.ts','utf8');if(!c.includes('失败计数与 worker OOM 文案同现'))process.exit(1)" && echo OK
```

**硬阈值**: 该场景下整体退出码 ≠ 0

---

### Step 3: 仅 OOM 无失败计数时继续判定为预存在环境问题（宽免保留）
**来源**: `[FROM_PRD]` — Golden Path 步骤 4："若输出中不存在明确的测试失败计数，即使出现 worker 异常退出/OOM 文案，quickcheck 判定为'预存在环境问题，非代码问题'，不阻塞"

**可观测行为**: 构造"仅 OOM 无失败计数"的 vitest 输出 fixture 时，quickcheck 对该包不判定为失败，整体退出码为 0（本次修复不得移除该宽免，只调整优先级）

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/engine/tests/scripts/quickcheck-oom-priority.test.ts','utf8');if(!c.includes('仅 worker OOM、无任何失败计数'))process.exit(1)" && echo OK
```

**硬阈值**: 该场景下整体退出码 = 0

---

### Step 4: 正常全部 PASS 场景保持退出码 0（禁止引入误报）
**来源**: `[FROM_PRD]` — 范围限定："正常 PASS 必须保持 0"；边界情况："正常全绿 PASS（vitest 退出码 0）必须继续保持 quickcheck 整体退出码 0，不允许本次修复引入新的误报"

**可观测行为**: 构造"正常全部 PASS"的 vitest 输出 fixture（vitest 退出码 0）时，quickcheck 整体退出码为 0

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/engine/tests/scripts/quickcheck-oom-priority.test.ts','utf8');if(!c.includes('正常全部 PASS 时'))process.exit(1)" && echo OK
```

**硬阈值**: 该场景下整体退出码 = 0

---

### Step 5: 多包混合场景，整体结果以失败为准（顺序无关）
**来源**: `[FROM_PRD]` — 边界情况："一次 quickcheck 运行覆盖多个改动包时，其中一个包'仅 OOM 无失败'、另一个包'明确失败'，整体结果必须以失败为准（不能被先跑到的 OOM 包影响后续判定）"

**可观测行为**: 构造两个改动包（一个仅 OOM、另一个失败+OOM 同现）的 fixture 组合时，quickcheck 整体退出码非 0，与包处理顺序无关

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/engine/tests/scripts/quickcheck-oom-priority.test.ts','utf8');if(!c.includes('多包混合场景'))process.exit(1)" && echo OK
```

**硬阈值**: 该场景下整体退出码 ≠ 0

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | `scripts/quickcheck.sh` 对每个改动包运行 vitest 后，必须让"明确的测试失败计数"优先于"worker OOM 宽免"判定失败，且不破坏"仅 OOM 无失败"与"正常 PASS"两类场景的现有放行行为 | 见上 Golden Path Step 2-5 |
| **NFR（做得多好）** | 无新增性能/延迟要求；沿用现有互斥锁 2s/mkdir-lock 超时（不在本次修改范围） | 待定（PrepPRD 未指定），沿用现状 |
| **Invariant（永不违反）** | 正常 PASS 场景必须保持退出码 0；不得修改 `packages/brain/src`；不涉及 DB migration；不改变互斥锁/DoD 守卫逻辑 | 见范围限定 |
| **判定点（怎么知道）** | 见下方判定点登记表 | 见下 |
| **保质期（何时过期）** | 本修复无时效性，长期有效直到 vitest 输出格式发生不兼容变化 | N/A（无过期机制，随 vitest 升级人工复核） |
| **死亡告警（停了谁知道）** | 若分类逻辑再次失效（真实失败被吞掉），由永久回归测试 `quickcheck-oom-priority.test.ts` 在 CI 每次运行中拦截，红即可知 | CI 红灯即告警，无需额外监控 |
| **失败语义（挂了怎么办）** | 见下方失败语义声明 | 见下 |
| **效果确认（已发≠已生效）** | 每次 quickcheck 运行的终端输出直接给出 `❌ 失败` / `✅ 通过` 文案，退出码是唯一权威判据 | 退出码 + 终端文案 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| vitest 本次运行是否存在真实测试失败 | A. 仅匹配逐文件 ` FAIL ` 标记（现状，有缺陷）; B. 汇总行失败计数正则（如 `Tests\s+[1-9][0-9]*\s+failed`）优先于 OOM 文案判断; C. 两者取或（任一命中即失败） | B（汇总行失败计数优先） | 汇总行在 vitest 各版本输出格式中最稳定存在，即使 worker 崩溃导致逐文件标记缺失，只要至少一个测试完整跑完并失败，汇总行仍会体现计数；A 已被证明会漏判 | 误判为"仅 OOM"→ 坏代码被放行 push，是本次 fire-drill 的直接根因，⚠️ |

⚠️ 该判定点误判后果为"坏代码绕过预检被 push"，如果 Generator 实现的正则模式未来被 vitest 输出格式变更打破，需要重新校准——本合同未涉及新增判定点讨论会，若后续需调整匹配正则细节，属实现阶段自行决定范围，不升级为需要用户拍板的判定点变更。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| vitest 子进程本身启动失败（如 vitest 未安装） | 维持现状：打印 "vitest 未安装，跳过"，不阻塞（本次不改变范围） | N/A（无状态） | 沿用现状，超出本次 sprint 范围 |
| 分类逻辑判定为失败 | quickcheck 整体退出码非 0，打印 `❌ 失败 — 修复后重新 push`，pre-push hook 据此阻止本次 push | 是（开发者修复后重新执行 quickcheck 天然幂等，无副作用状态需清理） | 无降级，明确阻断是设计目标 |

### 输入对抗面

本任务不涉及对外暴露 agent（无客服 agent / 无外部用户可写入接口），`（本任务无外部输入对抗面，N/A）`

## 禁 mock 边清单

本单改动为 `scripts/quickcheck.sh` 内 vitest 输出文本分类优先级修复（纯本地 CLI 脚本的字符串/正则判断逻辑），不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径中的任何一类——quickcheck.sh 是开发者本地终端直接调用的独立脚本，不读写数据库，不与其他模块进行运行时数据传递。

说明本单唯一涉及的外部边界：`scripts/quickcheck.sh` 分类逻辑 ↔ 真实 `vitest` 子进程输出。该边**不 mock**——Generator 的实现与回归测试均运行真实、未修改的 `scripts/quickcheck.sh`（复制其真实内容到隔离的临时 git 仓库中执行，而非重写/精简分类逻辑本身）。唯一被替身的是 `vitest` 这一外部工具二进制本身（本单不修改的第三方依赖），用可控 fixture 文本模拟其 stdout/退出码组合，原因见下方"未覆盖真实链路清单"。

（本单无调度/状态机/跨模块数据传递/生命周期钩子/DB写路径改动，故按定义清单为空；上述外部工具边界的替身已在"未覆盖真实链路清单"显式登记，不属静默 mock。）

## 未覆盖真实链路清单

- 被 mock 的真实链路点：`vitest` 子进程在真实 worker OOM 崩溃时的实际 stdout 格式
- 为什么：真实触发 Node.js worker 因内存耗尽而崩溃，在 CI/沙箱环境中不确定性极高（依赖具体内存压力、V8 版本、系统资源），无法确定性复现，且会拖慢/污染测试套件本身的资源
- 真验证补位计划：不需要补位。验证目标是 `scripts/quickcheck.sh` 的文本分类逻辑本身（这是本 sprint 唯一变更对象），fixture 文本精确复刻已知真实 bug 场景的两个关键特征（① 含 OOM/worker 异常退出文案 ② 汇总行含失败计数但无逐文件 ` FAIL ` 标记）——分类逻辑只读取这两个特征做判断，不关心 vitest 内部如何产生它们，故 fixture 是该判定点的正确验证边界，非取巧规避

## 真实调用方请求 shape

N/A — 本任务不涉及设备/agent 调用服务端场景，`scripts/quickcheck.sh` 是开发者本地终端直接执行的脚本，唯一调用方是 `packages/engine/hooks/pre-push.sh`（git pre-push hook 本地直接 `bash` 调用，非网络请求，无认证 header/body 概念）。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# 1. 语法与静态检查：修复后的 quickcheck.sh 必须仍是合法 bash，且不触碰 brain/src
bash -n scripts/quickcheck.sh || { echo "FAIL: quickcheck.sh 语法错误"; exit 1; }
if git diff --name-only origin/main...HEAD 2>/dev/null | grep -q '^packages/brain/src/'; then
  echo "FAIL: 本次改动触碰了 packages/brain/src，超出范围"; exit 1
fi
echo "OK: 语法合法且未触碰 packages/brain/src"

# 2. 安装依赖（若尚未安装）
if [[ ! -d node_modules/.bin ]]; then
  npm install --prefer-offline --no-audit --no-fund
fi

# 3. 运行永久回归测试（TDD 红→绿的绿证据；四类场景全部覆盖）
# 用 packages/engine 自身 node_modules/.bin/vitest（与 package.json "test" 脚本一致），
# 不强用根目录 hoisted 版本 —— 根目录与 packages/engine 可能存在独立锁定的不同 vitest 版本
cd packages/engine
NODE_OPTIONS='--max-old-space-size=2048' \
  node_modules/.bin/vitest run tests/scripts/quickcheck-oom-priority.test.ts --reporter=verbose \
  | tee /tmp/quickcheck-oom-priority-e2e.log
RESULT_EXIT=${PIPESTATUS[0]}
[ "$RESULT_EXIT" -eq 0 ] || { echo "FAIL: quickcheck-oom-priority.test.ts 未全绿"; exit 1; }
grep -qE '4 passed|passed \(4\)' /tmp/quickcheck-oom-priority-e2e.log || { echo "FAIL: 未确认 4 个场景全部通过"; exit 1; }

echo "✅ Golden Path 验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 失败计数与 worker OOM 文案同现时非零退出 | `packages/engine/tests/scripts/quickcheck-oom-priority.test.ts` | 失败计数与 worker OOM 文案同现 | 现状代码下该 it() FAIL（误判为 exit 0） |
| 仅 OOM 无失败时保持 0（宽免不误伤） | `packages/engine/tests/scripts/quickcheck-oom-priority.test.ts` | 仅 worker OOM、无任何失败计数 | 现状代码下该 it() 已 PASS（非回归目标，作为宽免不误伤基线） |
| 正常 PASS 时保持 0（不引入误报） | `packages/engine/tests/scripts/quickcheck-oom-priority.test.ts` | 正常全部 PASS 时 | 现状代码下该 it() 已 PASS（回归保护基线） |
| 多包混合场景以失败为准 | `packages/engine/tests/scripts/quickcheck-oom-priority.test.ts` | 多包混合场景 | 现状代码下该 it() FAIL（同一根因，OOM 宽免优先级错误） |

（“BEHAVIOR 覆盖”列均为 `packages/engine/tests/scripts/quickcheck-oom-priority.test.ts` 中对应 `it()` 测试名的字面子串，可用 `grep -F` 命中。）
