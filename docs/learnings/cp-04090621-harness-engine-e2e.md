### 根本原因

本次合同实现 4 个 Feature：
1. branch-protect.sh 添加 DoD `[ ]` 未勾选条目检测（F1 Scene 3）
2. 新建 `packages/engine/ci/scripts/check-learning-format.sh` — Learning Format Gate，检测 `### 根本原因` 章节 + 同名文件 diff context 陷阱
3. 新建 `packages/engine/scripts/e2e-integrity-check.sh` — E2E 完整性检测（8 个 PASS 检测点，不依赖 Brain API）
4. `.github/workflows/ci.yml` engine-tests job 新增 e2e-integrity-check 步骤
5. `sprints/ci-coverage-assessment.md` — CI/CD Gate 覆盖范围评估报告（3 个盲区识别）

关键发现：e2e-integrity-check.sh 使用 `cd "$SCRIPT_DIR/../../.."` 定位项目根，必须上溯三级（packages/engine/scripts → 根目录）。

### 下次预防

- [ ] 新建脚本时验证路径定位逻辑（`pwd` 输出是否为预期根目录）
- [ ] 注释中避免出现 "localhost:5221" 等字符串，防止 grep 检测误报
- [ ] e2e-integrity-check 运行后验证 PASS 数量 ≥5 才可提交
