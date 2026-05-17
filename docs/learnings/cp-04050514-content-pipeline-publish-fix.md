# Learning: 内容发布链路 pre-flight 失败导致 96 个任务全部取消

## 分支
cp-04050514-faab0eb6-8bfd-4900-bfe1-17550d5d1fd9

## 根本原因

### 问题 1：content_publish pre-flight 失败
`_createPublishJobs()` 创建发布任务时未设置 `description` 字段。
`pre-flight-check.js` 对所有非 SYSTEM_TASK_TYPES 任务强制检查 description，
导致 96 个 content_publish 任务在调度前全部被 `canceled`，发布从未执行。

### 问题 2：executeExport 零图片即失败
research 阶段产出的 findings 若 `brand_relevance < 3`，
`generateCards()` 返回 false，`executeExport` 直接返回 `{ success: false }`。
pipeline 被标记 failed，tick 重建新 research 子任务，形成无限循环（100+ 子任务风暴）。

## 下次预防

- [ ] 新增 task type 时，评估是否属于系统自动生成型（指令在 payload 不在 description）→ 加入 SYSTEM_TASK_TYPES
- [ ] pipeline 的中间阶段 executor 失败时，优先降级（warn）而非直接 `{ success: false }`，避免 pipeline 重启风暴
- [ ] `_createPublishJobs` 等批量创建函数写完后，检查创建的任务是否满足 pre-flight 要求（description ≥ 20 chars）
- [ ] 写 content pipeline 相关任务时，验证 export → publish jobs 链路端到端，包括 pre-flight 检查
