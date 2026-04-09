# Contract Review Feedback (Round 3)

> reviewer_task_id: 52b204c7-8fd0-4b5d-af6b-905b1ca4824c
> propose_task_id: 5a6d11f8-c446-4fe7-b3f6-d297ecda2e69
> verdict: REVISION
> issues_count: 2

---

## 必须修改项

### 1. [命令太弱] Feature 1 & Feature 4 — `last_executed_at` 时区验证完全缺失

**问题**：PRD 明确要求 `last_executed_at` 必须是**上海时区（UTC+8）**格式字符串，但 Feature 1 和 Feature 4 的验证命令仅用正则 `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/` 检查格式，**未验证时区**。

**影响**：一个返回 UTC 时间的错误实现（如直接 `new Date().toISOString().replace('T',' ').substring(0,19)`，返回 UTC 时间而非上海时间）能 100% 通过所有验证命令——格式完全合规，但时区偏差 8 小时，PRD 要求被悄然违反。

**建议修复**：在 Feature 1（或 Feature 4）中增加时区一致性验证命令——将 `last_executed_at` 解释为上海时区（附加 `+08:00` offset），与服务器当前时间比较，若差值超出合理范围（> uptime + 60s），则判定时区错误：

```bash
# 时区一致性验证：last_executed_at 必须是上海时区（UTC+8）
curl -sf localhost:5221/api/brain/health | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const ts = d.tick_stats;
  if (!ts || ts.last_executed_at === null) {
    console.log('INFO: last_executed_at 为 null，跳过时区验证');
    process.exit(0);
  }
  // 把 last_executed_at 解释为 UTC+8（上海时区）
  const reported = new Date(ts.last_executed_at.replace(' ', 'T') + '+08:00');
  const now = new Date();
  const diffMs = now - reported;
  const uptimeSec = d.uptime || 0;

  // 若 diffMs < 0：报告时间在未来 → 时区可能是 UTC（+8 后会超过现在）
  if (diffMs < 0) {
    console.error('FAIL: last_executed_at 解析为上海时区后在未来（时区错误？）: ' + ts.last_executed_at + ', diff=' + Math.round(diffMs/1000) + 's');
    process.exit(1);
  }
  // 若 diffMs > (uptime + 60s)：报告时间比 Brain 启动更早 → 时区可能不是 UTC+8
  if (diffMs > (uptimeSec + 60) * 1000) {
    console.error('FAIL: last_executed_at 早于 Brain 启动时间（时区错误？）: ' + ts.last_executed_at + ', uptime=' + uptimeSec + 's, diff=' + Math.round(diffMs/1000) + 's');
    process.exit(1);
  }
  console.log('PASS: last_executed_at=' + ts.last_executed_at + ' 时区合理（距今 ' + Math.round(diffMs/1000) + 's，Brain uptime=' + uptimeSec + 's）');
"
```

---

### 2. [合同描述与验证不一致] Feature 1 — "仅包含三个字段"无法被验证命令检测

**问题**：合同行为描述写 "`tick_stats` 包含且仅包含以下三个字段"，但验证命令只检查三个字段存在（`required.filter(k => !(k in ts))`），并未检查是否有多余字段。

**影响**：一个返回额外字段（如 `tick_stats.extra_field`）的实现会通过验证，但与合同描述矛盾。虽然对功能正确性影响较小，但合同承诺的约束应可被验证。

**建议修复**（二选一）：
- 方案 A（推荐）：删除合同描述中的"且仅包含"措辞，改为"至少包含"，避免承诺无法验证的约束。
- 方案 B：加入额外字段检查命令：
  ```bash
  # 验证 tick_stats 不含额外字段
  curl -sf localhost:5221/api/brain/health | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const ts = d.tick_stats || {};
    const allowed = new Set(['total_executions', 'last_executed_at', 'last_duration_ms']);
    const extra = Object.keys(ts).filter(k => !allowed.has(k));
    if (extra.length > 0) {
      console.error('FAIL: tick_stats 包含意外字段: ' + extra.join(', '));
      process.exit(1);
    }
    console.log('PASS: tick_stats 仅包含三个规定字段');
  "
  ```

---

## 可选改进

- Feature 4 的"可观测递增"只能侧面验证（via uptime > 60s），无法直接测试两次调用间的递增行为。这是测试环境合理限制，可接受，但建议在合同注释中明确说明这是已知局限（非漏洞）。

---

## 合格项（不需要修改）

- Feature 1 happy path 命令严格：验证了 object 类型、integer 整数、非负、格式正则，非空校验强。
- Feature 2 一致性验证设计合理：`atNull !== msNull` 两者同步为 null 的联动约束有效。
- Feature 3 向后兼容命令完整：status + uptime + HTTP 200 均有对应命令。
- Feature 4 uptime 侧面验证有效：`uptime > 60s → total_executions > 0` 能发现 tick 未运行的问题。
- 全部命令无占位符，可直接执行。
- 端口假设（5221）正确。
