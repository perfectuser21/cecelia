# Sprint PRD — scripts/relay-demo/sort-json-keys.mjs JSON 键排序小工具 + vitest

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：验证 codex relay one-session 链路可稳定产出一个本地可验的小型交付物

## 背景

本 sprint 用 `scripts/relay-demo/sort-json-keys.mjs JSON 键排序小工具 + vitest` 作为非核心路径实证样本，验证 executor=codex 的 relay 链路可以把一个范围收敛、CLI 可验的任务推进到合同产物、代码产物和测试产物齐备。

## Golden Path（核心场景）

用户/系统从 [提供一个 JSON 文件路径] → 经过 [执行 `scripts/relay-demo/sort-json-keys.mjs JSON 键排序小工具 + vitest` 对输入 JSON 做递归键排序并输出结果] → 到达 [stdout 获得稳定排序后的 JSON，且 vitest 证明嵌套对象、数组、空对象三类输入都满足预期]

具体：
1. 使用者提供一个可读取的 JSON 文件路径，作为本工具唯一输入。
2. 系统输出一个 JSON 结果；对象键按字典序递归稳定排列，数组顺序保持输入语义不变，数组中的对象元素同样满足递归键排序。
3. 使用者在本地运行测试时，可以看到嵌套对象、数组、空对象三个用例全部通过。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 输入 JSON 含空对象时，输出仍为合法 JSON，且空对象保持为空对象。
- 输入 JSON 含数组时，数组元素数量与原始顺序不变，只校正其中对象元素的键顺序。
- 输入 JSON 已经有序时，输出结果仍应与其语义一致，不能引入额外字段或丢失字段。

## 范围限定

**在范围内**：`scripts/relay-demo/sort-json-keys.mjs` 的单文件命令行行为；递归键排序的 stdout 结果；vitest 对嵌套对象、数组、空对象三类输入的合同化验证；本 sprint 合同产物
**不在范围内**：修改 `packages/brain/src`、`migrations` 或其他核心路径；新增外部依赖；任何截图或视觉断言；超出 JSON 键排序工具本身的通用格式化能力承诺

## 假设

- [ASSUMPTION: 输入文件内容为合法 JSON，本 sprint 不额外定义非 JSON 文本的容错体验]
- [ASSUMPTION: step_id 未在任务 payload 中显式给出，本合同以当前 journey 的 Step 1 规划占位]

## 预期受影响文件

- `scripts/relay-demo/sort-json-keys.mjs`：本 sprint 的目标交付物
- `scripts/relay-demo/` 下测试文件：覆盖嵌套对象、数组、空对象三个合同用例
- `sprints/07071247-relay-demo-codex-r2/sprint-prd.md`：本 sprint 合同

## NFR

- 无外部依赖：交付物应保持本地可执行，不引入额外第三方运行时依赖
- 可验证性：合同断言必须全部通过 CLI 与测试输出验证，不依赖截图或人工视觉判断
- 运行环境：目标环境固定为 `local_api`，验收以本地命令执行结果为准
- 稳定性：相同输入文件应得到稳定、可复现的 stdout JSON 输出

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [范围封箱] 改动范围只允许新增 `scripts/relay-demo/` 下文件与 `sprints/` 合同产物，不得触碰 `packages/brain/src` 与 `migrations`（来源: PrepPRD）
- [CLI真验] 合同断言必须全部通过 CLI 验证，不得使用截图或视觉断言作为完成信号（来源: PrepPRD）
- [工具主题锁定] 本 sprint 主题固定为 `scripts/relay-demo/sort-json-keys.mjs JSON 键排序小工具 + vitest`，不得漂移到其他脚本或其他能力（来源: PrepPRD）
- [单slot串行] 同一 slot 同时只允许一个任务在跑；任务内部允许只读子代理并行，但写代码实现者同一时刻只能有一个（来源: area）
- [禁写死环境假设] 环境假设值不得写死；接缝相关前提必须来自真实环境或可验证输入（来源: area）
- [真环境验证才算done] 接缝断言必须在目标环境验证过才算 done；未验证只能视为待确认（来源: area）
- [测试默认多租户] 单元或 E2E 测试默认应具备隔离意识，避免隐式共享状态（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私或敏感内容不得明文进日志（来源: area）
- [端点鉴权] 若任务触及 API 端点，不得产生无鉴权可交付物（来源: area）
- [租户隔离] 若任务触及租户数据，不得发生跨租户混读混写（来源: area）

## 累积 FR

（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=local_api）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 提供一个 JSON 文件路径并执行 scripts/relay-demo/sort-json-keys.mjs 后，stdout 返回合法 JSON
# 2. 输出中的所有对象键按字典序递归稳定排序
# 3. 数组顺序保持不变，数组中的对象元素同样符合递归排序预期
# 4. vitest 对嵌套对象、数组、空对象三个用例全部通过
# 5. 改动范围仅命中 scripts/relay-demo/ 与 sprints/07071247-relay-demo-codex-r2/
```

## journey_type: autonomous
## journey_type_reason: thin_prd 未指向前端、远端 agent 协议或 engine 流程，且目标是本地可验的后端/脚本型交付，按默认规则归类为 autonomous
## target_environment: local_api
## target_environment_reason: 任务显式指定 target_environment=local_api，验收信号为本地命令与测试输出
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: （PrepPRD 未指定 step_id）
