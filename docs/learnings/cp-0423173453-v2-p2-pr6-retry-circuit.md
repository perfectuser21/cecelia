## v2 P2 PR6 retry-circuit Middleware（2026-04-23）

### 根本原因

v2 P2 第 6 PR，新增 retry-circuit middleware。和 PR5 一样暂不接线，纯模块 + 单测。核心是把"失败分类"和"是否重试判断"两个职责拆成两个函数：`classifyFailure(result)` 返回 `{ class, reason }`，`shouldRetry(classification, attemptIndex, maxAttempts)` 返回 boolean。这样未来 attempt-loop 里可以按需独立调用，也方便测。

permanent/transient 的分界是一组 regex 启发式 — exit 124/137 特殊处理 (timeout vs OOM)，网络错误系列关键字匹配，docker 镜像问题明确永久。不 100% 精准但覆盖 80% 常见场景，剩下的走默认 transient 给一次 retry 机会。

### 下次预防

- [ ] **"纯职责"拆分 middleware**：retry-circuit 不写成一个函数而是两个，是因为 classifyFailure 是 "纯诊断"，shouldRetry 是 "策略决策"。后者依赖前者的输出，但二者可以独立被替换（例如不同 task_type 走不同 maxAttempts 策略）。以后 middleware 设计默认考虑"纯函数 + 策略函数"的分离
- [ ] **exit_code 137 别 blanket 当 OOM**：当前判断是"137 + 非 timed_out → permanent"。但 137 也可能是手动 docker kill / 外部 SIGKILL，不一定是 OOM。精准判断需要看 dmesg / cgroup oom stats — 属于 P4 observer 的事。当前 PR 的简化是可接受的
- [ ] **PERMANENT_PATTERNS 的增补路径要预留**：未来会加更多 permanent 信号（语法错误 / 依赖缺失 / 权限 denied 等）。现在用 module-level const 数组方便扩展
