# Learning: fix(engine): verify-step.sh seal key 映射 + Gate 0d 文件过滤

## 根本原因

### P0: seal key 命名不一致

`verify-step.sh` 的 `_pass()` 函数将 `STEP` 变量（值为 `step1`/`step2`/`step4`）直接拼接 `_seal:` 后缀，写入格式为 `step1_seal: verified@...`。但 `stop-dev.sh` 的 `_SEALED_STEPS=("step_1_spec" "step_2_code" "step_4_ship")` 期望格式为 `step_1_spec_seal: verified`。两者永远不匹配，导致 Stage 4 完成后 State Machine 永远检测到验签缺失，陷入死循环。

### P1: Gate 0d find 分组错误

```bash
# 错误：-o 连接的条件未加括号，maxdepth 只作用于第一个 -name
find "$vdir" -maxdepth 1 -name "*.json" -o -name "*.yaml" -o -name "*.yml"

# 正确：括号分组确保 maxdepth 对所有条件生效
find "$vdir" -maxdepth 1 \( -name "*.json" -o -name "*.yaml" -o -name "*.yml" \)
```

### P1: Gate 0d 误报独立版本体系

`skills-registry.json` 使用独立版本号（`1.0.0`），与 engine 版本（`13.x.x`）不同。Gate 0d 错误地将其纳入版本一致性检查，导致误报。修复：只检查 `package.json`/`package-lock.json`/`regression-contract.yaml`（已知版本同步文件）。

## 下次预防

- [ ] 新增 seal key 时，必须同时检查 `verify-step.sh` 写入格式和 `stop-dev.sh` 消费格式，确保命名一致
- [ ] `find` 命令使用多个 `-name` 条件时，必须用 `\( ... \)` 括号分组，否则 `-maxdepth` 不生效
- [ ] Gate 0d 扫描周边文件时，需维护白名单（而非扫描所有同类型文件），避免误报独立版本体系
- [ ] `stop-dev.sh` 中 `_SEALED_STEPS` 数组的值（`step_1_spec` 等）是单一真相，`_pass()` 的 case 语句必须与其严格对齐
