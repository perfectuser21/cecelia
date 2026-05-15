## B42 propose_branch mismatch tolerance（2026-05-15）

### 根本原因

LLM 在容器内执行时，prompt 里的 `${PROPOSE_BRANCH}` 被 LLM "展开"成自己计算的时间戳分支名（如 `cp-harness-propose-r1-05152044`），而不是 Brain 注入的确定性值。Brain 的严格 ContractViolation 因此阻断了整个 pipeline。

### 下次预防

- [ ] env var 在 prompt 里以 `${VAR}` 形式出现时，LLM 倾向于"展开"它。改为在 prompt 文本中直接注入字面值（`VAR="literal-value"`）
- [ ] Brain 对 LLM 容器输出的匹配检查，应先 warn + 接受实际值，而非直接 throw；strict throw 适用于协议层（文件缺失、schema 损坏），不适用于 LLM 语义层（值内容偏差）
- [ ] 类似 proposer/evaluator 的 prompt 构建函数，每次派发时显式传入确定性的外部注入值，不依赖容器的 env var 展开
