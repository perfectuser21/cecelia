---
id: drca-v2
version: 2.0.0
created: 2026-01-24
updated: 2026-01-24
changelog:
  - 2.0.0: 事件驱动诊断闭环（对齐 v2.0.0 两阶段工作流）
---

# DRCA v2.0 - 事件驱动诊断闭环

**Diagnostic & Repair Closed-loop Automation**

**核心变化**: 从"连续等待诊断"升级到"事件驱动诊断"

---

## 核心原则

```
❌ 旧模式: while CI pending; do diagnose; sleep; done  # 挂着等
✅ 新模式: CI fail → diagnose → fix → push → exit → wait for next event
```

**关键**：不挂着，每次 CI fail 唤醒一次，修复后立即退出。

---

## 触发源

| 触发源 | 条件 | 输入 | 入口 |
|--------|------|------|------|
| **CI fail** | GitHub Actions 任意 job 失败 | PR 号 + failing job 名称 | notify-failure job |
| **DevGate fail** | DevGate checks 失败 | PR 号 + DevGate check 名称 | CI test job |
| **Regression fail** | 回归测试失败 | PR 号 + failing RCI | release-check job |
| **手动触发** | 用户指定 p1 模式 | PHASE_OVERRIDE=p1 | CLI |

---

## 事件驱动流程

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. 触发阶段
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GitHub Actions job fail
    ↓
notify-failure job 执行
    ├─ 发送通知到 Notion
    │   └─ Status: Failed
    │       Branch: xxx
    │       PR: #123
    │       Failure: version-check / test / DevGate
    │
    └─ (可选) webhook 触发 VPS
        └─ 立即启动 p1 修复

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  2. 唤醒阶段
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

方案 A: n8n 轮询 Notion (5分钟)
    ↓
查询 Notion CI Database
    ├─ 过滤: Status = "Failed"
    └─ 提取: PR 号 + Branch + Failure 原因
    ↓
PHASE_OVERRIDE=p1 cecelia-run "修复 PR #123..."

方案 B: GitHub Actions webhook
    ↓
curl POST VPS /webhook/ci-fail
    ↓
VPS 接收 → 立即启动 p1 runner

方案 C: VPS cron 轮询 (1分钟)
    ↓
gh pr list --state open
    ↓
检查每个 PR 的 CI 状态
    ↓
发现 fail → 启动 p1 runner

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  3. 诊断阶段 (Diagnostic)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

p1 runner 启动
    ↓
阶段检测: PHASE=p1
    ↓
拉取 CI 失败详情:
    gh pr checks "$PR_NUMBER" --json name,conclusion,detailsUrl
    ↓
分析失败类型:
    ├─ version-check fail
    │   → package.json 版本号未更新
    │   → 分析: git diff origin/develop package.json
    │
    ├─ test fail (typecheck/test/build)
    │   → 拉取日志: gh run view --log-failed
    │   → 分析: 错误信息定位到文件/行
    │
    ├─ DevGate fail
    │   ├─ DoD 映射缺失
    │   │   → 分析: .dod.md 缺哪些测试
    │   │
    │   ├─ P0/P1 RCI 未更新
    │   │   → 分析: PR title + regression-contract.yaml diff
    │   │
    │   └─ RCI 覆盖率不足
    │       → 分析: 新增入口点 + regression-contract.yaml
    │
    └─ Regression fail
        → 拉取失败的 RCI 列表
        → 分析: 哪些契约被破坏

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  4. 修复阶段 (Repair)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

根据诊断结果修复:
    ├─ version-check fail
    │   → npm version patch / minor / major
    │   → 更新 CHANGELOG.md
    │
    ├─ typecheck fail
    │   → 修复类型错误
    │
    ├─ test fail
    │   → 修复测试或修复代码
    │
    ├─ build fail
    │   → 修复构建错误
    │
    ├─ DevGate fail
    │   ├─ DoD 映射: 补测试文件
    │   ├─ P0/P1: 更新 regression-contract.yaml
    │   └─ RCI 覆盖率: 添加新 RCI
    │
    └─ Regression fail
        → 修复破坏契约的代码

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  5. 验证阶段
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

本地验证（可选）:
    npm run qa  # 跑 L1 确保本地通过
    ↓
提交修复:
    git add .
    git commit -m "fix: CI 失败修复 - <具体问题>"
    git push
    ↓
触发 CI 重跑:
    GitHub Actions 自动触发
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  6. 退出阶段（不等待）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stop Hook 检查:
    CI_STATUS=$(gh pr checks "$PR_NUMBER" --json state -q '.[].state')

    if [[ "$CI_STATUS" == "PENDING" ]]; then
        echo "✅ CI pending，退出等待下次唤醒"
        exit 0  # 退出，不挂着

    elif [[ "$CI_STATUS" == "FAILURE" ]]; then
        echo "❌ CI 仍然失败"
        exit 2  # 再次循环修复（同一会话）

    elif [[ "$CI_STATUS" == "SUCCESS" ]]; then
        echo "✅ CI 通过，进入 p2"
        exit 0  # 进入 p2 阶段
    fi

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  7. 循环或完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CI pending:
    → p1 会话结束（exit 0）
    → 等待下次 CI fail 通知唤醒
    → 重复 2-6 步骤

CI pass:
    → 进入 p2 阶段
    → auto-merge job 自动合并 PR
    → Learning → Cleanup
    → ✅ 完成
```

---

## 诊断命令速查

### 1. 拉取 CI 失败详情

```bash
# 获取 PR 的所有 checks
gh pr checks "$PR_NUMBER" --json name,conclusion,detailsUrl

# 只看失败的
gh pr checks "$PR_NUMBER" | grep "fail" -i

# 获取最新的 workflow run
gh run list --branch "$BRANCH" --limit 1

# 查看失败的 job 日志
gh run view <run-id> --log-failed
```

### 2. 分析失败类型

```bash
# version-check
git diff origin/develop package.json | grep version

# typecheck
npm run typecheck 2>&1 | grep "error TS"

# test
npm test 2>&1 | grep "FAIL"

# DevGate - DoD 映射
node scripts/devgate/check-dod-mapping.cjs

# DevGate - P0/P1 RCI
bash scripts/devgate/require-rci-update-if-p0p1.sh

# DevGate - RCI 覆盖率
node scripts/devgate/scan-rci-coverage.cjs
```

### 3. 快速修复

```bash
# 版本号
npm version patch  # fix:
npm version minor  # feat:
npm version major  # feat!:

# typecheck
# 修复 TS 错误后重跑
npm run typecheck

# test
# 修复测试后重跑
npm test

# DevGate - 添加 RCI
# 手动编辑 regression-contract.yaml
```

---

## 自动化集成

### 方案 A: n8n + Notion

```
n8n Task Dispatcher v2.0
    ↓
查询 Notion CI Database (Status=Failed)
    ↓
提取 PR 信息
    ↓
Execute Command 节点:
    PHASE_OVERRIDE=p1 cecelia-run "修复 PR #{{ $json.pr_number }}..."
    ↓
cecelia-run 执行 DRCA 流程
    ↓
更新 Notion (Status=Fixing → Fixed/Failed)
```

### 方案 B: GitHub Actions webhook

```yaml
# .github/workflows/ci.yml
notify-failure:
  steps:
    - name: Notify VPS
      run: |
        curl -X POST "${{ secrets.VPS_WEBHOOK_URL }}/ci-fail" \
          -H "Content-Type: application/json" \
          -d '{
            "pr_number": "${{ github.event.pull_request.number }}",
            "branch": "${{ github.head_ref }}",
            "failure": "version-check"
          }'
```

VPS webhook 服务器：
```javascript
app.post('/ci-fail', (req, res) => {
  const { pr_number, branch, failure } = req.body;

  exec(`PHASE_OVERRIDE=p1 cecelia-run "修复 PR #${pr_number}..."`,
    (error, stdout, stderr) => {
      // 记录结果
    }
  );

  res.json({ status: 'triggered' });
});
```

---

## 诊断 Checklist

修复前必须明确：

- [ ] **失败类型**：version-check / typecheck / test / build / DevGate / Regression
- [ ] **失败原因**：具体错误信息 / 日志片段
- [ ] **影响范围**：哪些文件 / 哪些 RCI
- [ ] **修复方案**：代码改动 / 配置更新 / RCI 添加
- [ ] **验证方法**：本地跑什么命令

---

## 关键指标

### 成功标准

- ✅ 诊断时间 < 2 分钟
- ✅ 修复时间 < 10 分钟
- ✅ 验证通过率 > 90%
- ✅ 自动唤醒延迟 < 5 分钟（n8n）或 < 1 分钟（webhook/cron）

### 失败场景

- ❌ 诊断不出原因 → 人工介入
- ❌ 修复 20 轮仍失败 → 标记 NEED_HUMAN_HELP
- ❌ CI 挂起（pending > 30分钟）→ 超时告警

---

## 相关文档

- `docs/contracts/WORKFLOW-CONTRACT.md` - 两阶段工作流状态机
- `features/feature-registry.yml` - Feature 定义（N1: Cecelia）
- `hooks/stop.sh` - p1 阶段 Stop Hook 实现
- `scripts/detect-phase.sh` - 阶段检测脚本
- `.github/workflows/ci.yml` - CI 配置 + notify-failure

---

**版本**: 2.0.0
**状态**: ✅ Production Ready（需配置唤醒机制）
**最后更新**: 2026-01-24
