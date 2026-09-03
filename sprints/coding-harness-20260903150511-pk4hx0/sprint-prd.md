# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 3a63ba8e42248c22bf0d1835e90f7ffa5d43dde07a34364fa00d7fdeed269234

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未提供
- **本次推进预期**：交付 attempt-run 桥接的单页中文使用说明

## 背景

为宿主和远端调用方提供统一的 attempt-run 桥接说明，明确端点用途、鉴权、角色与 payload 合同，以及派发失败后的状态回滚语义。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明携带 Bearer 凭据并提交 `POST /api/brain/harness/attempt-run` → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 能据文档理解正常状态或派发失败后的完整回滚结果。

具体：
1. 读者识别 POST 创建/派发 attempt-run、GET 按 id 查询 attempt-run 的不同用途。
2. 读者识别两端点采用 `internalAuthOrLoopback`，且宿主/远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 读者获得九项角色白名单的完整枚举，并能据此选择合法角色。
4. 读者识别 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 读者识别派发失败时状态按 `run→failed`、`session→closed`、`task→cancelled` 自动回滚。
6. 文档断言可由测试读取目标 Markdown 并逐项匹配上述关键词、枚举数量与状态转换覆盖。

## 边界情况

- 区分 loopback 与宿主/远端鉴权要求，不得让读者误以为远端可免 Bearer。
- 区分必填字段与可省略的 `base_sha`，不得将生产 Brain 自解析描述成调用方必传。
- 失败回滚必须同时覆盖 run、session、task 三类状态，不能只描述其中一项。

## 范围限定

**在范围内**：仅新增 `docs/current/` 下一个中文 Markdown 页面，包含端点用途与鉴权、九项角色白名单、payload 字段规则、派发失败自动回滚四节；提供可由测试文件覆盖的验收断言。

**不在范围内**：不修改产品代码、接口行为、鉴权实现、测试运行基础设施或其他 `docs/current/` 交付物。

## 假设

- [ASSUMPTION: 九项角色的准确名称以实现基线 `4cba7f91a79d3ae7f92e1658a958e4afd2df0c15` 中现行服务端白名单为准，文档必须逐项照录，不自创别名。]
- [ASSUMPTION: 目标文档文件名由实现者选择清晰且稳定的 kebab-case 名称，验收按新增 Markdown 页面及内容定位。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`: 新增《attempt-run 桥接使用说明》单页交付物。
- `packages/brain/test/attempt-run-doc.test.js`: 如仓库现有测试布局适用，新增文档合同回归测试；不得修改产品代码。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言与可读性：全文简体中文，端点、字段名、角色名和状态值保持精确字面。
- 安全：不得写入真实 token；仅使用变量名 `CECELIA_INTERNAL_TOKEN` 展示鉴权合同。
- 兼容性：说明必须忠于实现基线，不承诺基线不存在的行为。
- 可测试性：四节及其关键合同可由测试读取 Markdown 后机械断言。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅列与本次文档合同直接适用的 area 铁律 -->
- [Planner 分支] Planner 必须停留在服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [真相基线] 接口说明与验收必须以真实目标和冻结实现基线为准，不得写死未经核验的环境假设（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：目标中文 Markdown 存在；含两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、三个必填字段、base_sha 省略语义，以及 run→failed/session→closed/task→cancelled；git diff 不含产品代码或其他 docs/current 交付物修改。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 API 使用说明，无 UI 操作或远端 agent 协议行为变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在目标工作区对 Markdown 内容与变更范围做机械检查。
## journey_id: none
## step_id: none（PrepPRD 锚定为 none(docs)）
