# Learning: Sprint 2 R7 — SC-2 stop-dev.sh cleanup_done harness guard 结构修复

**分支**: cp-04052040-81b12ba6-d5bf-4d51-8fad-25fa4c
**时间**: 2026-04-06

---

### 根本原因

stop-dev.sh 的 harness 保护逻辑结构不符合合约验证器的预期。

**原结构**（v16.2.0）：
```bash
HARNESS_MODE_IN_FILE=$(...)
if [[ "$HARNESS_MODE_IN_FILE" != "true" ]] && grep -q "cleanup_done: true" ...; then
    exit 0
fi
```

问题：合约 SC-2 用 regex `/cleanup_done.*true[\s\S]{0,300}exit 0/` 匹配 cleanup_done 块，然后检查 "harness" 是否出现在匹配范围内。由于 harness 变量声明在 cleanup_done 检查之前（同一 if 的左侧），不在 regex 的 300 字符范围内，导致测试失败。

**新结构**（v16.3.0）：
```bash
if grep -q "cleanup_done: true" ...; then
    HARNESS_MODE_IN_FILE=$(...)
    if [[ "$HARNESS_MODE_IN_FILE" != "true" ]]; then
        exit 0
    fi
    # harness 模式：跳过 cleanup_done 早退
fi
```

"harness" 出现在 cleanup_done 块内部，regex 可检测到。

---

### 下次预防

- [ ] 写合约验证命令时，用 regex 匹配时要考虑关键词的位置顺序
- [ ] SC 验证命令与实现必须对齐：合约说"块内有 harness"，代码就必须把 harness 放在该块内部
- [ ] 每次修改 cleanup/exit 路径前，先用合约命令做本地验证
