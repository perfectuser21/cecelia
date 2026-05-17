# Learning: harness-skeleton-ci — skeleton-shape-check CI 实现

### 根本原因
skeleton task 的测试文件形式无机械校验，AI 可能输出不匹配 journey_type 的测试（比如 autonomous 用 Playwright），事后靠 code review 发现成本高。

### 下次预防
- [ ] 新增 journey_type 时，同步更新 skeleton-shape-check.cjs 的 PATTERNS 对象
- [ ] CI `continue-on-error: true` 观察期 1 周后检查误报率，确认无误报后删掉该行切硬门禁
- [ ] 单元测试中测试文件内容必须避免包含所测关键字（比如 user_facing 的否定测试不能在注释里写 "playwright/chromium"）
