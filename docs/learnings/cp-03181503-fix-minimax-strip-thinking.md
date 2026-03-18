# Learning: fix MiniMax 推理模型 <think> 标签导致空响应

## 概要

修复 `stripThinking` 函数：当 MiniMax 推理模型把所有内容包在 `<think>` 标签里时，降级提取 think 内容作为兜底，而不是抛出错误导致 Brain tick 停止。

## 变更内容

- `packages/brain/src/llm-caller.js`：`stripThinking` 增加降级逻辑
- `packages/brain/src/__tests__/llm-caller.test.js`：更新对应测试用例

### 根本原因

`MiniMax-M2.5-highspeed` 是推理模型，有时会把所有内容（包括最终答案）包在 `<think>` 标签里，不在标签外留任何内容。旧的 `stripThinking` 剥离后返回空字符串，`callMiniMaxAPI` 抛出 "MiniMax returned empty content" 错误，丘脑调用失败，Brain tick 停止。

### 下次预防

- [ ] 使用推理模型时，`stripThinking` 必须有降级逻辑（think 内容作为兜底）
- [ ] 测试用例应覆盖"全 think 格式"场景，并且期望值是降级成功，而非抛出错误
- [ ] 新增推理模型到 allowed_models 时，需确认 stripThinking 能处理其输出格式

## 教训

推理模型的输出格式与普通模型不同：答案可能完全在 `<think>` 标签内。
在剥离 think 内容后，要检查剩余内容是否为空，若为空则应降级而非直接报错。
