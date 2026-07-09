# Lead 客户机自验 — 铁律 7 详细规范

## 为什么有这条铁律（2026-05-07 walking-skeleton-1 抖音 thin 血泪教训）

walking-skeleton-1「客户首次成功路径」抖音版 thin 第一刀，所有 5 个 PR 合并后 CI 100% 绿。Lead 把"CI mock smoke 全绿"当成"端到端跑通"，没在真客户机走一遍，把用户当人肉测试机。结果客户实测暴露 **22 个细节 bug**，每一个只要 lead 在 Windows 真跑过一次就能 1 秒发现。

### 22 bug 分类（防止再犯）

| 类别 | 数量 | 典型 |
|---|---|---|
| **DB schema 与代码不同步** | 2 | `licenses_tier_check` 不允许 `tier='free'`；MP4 vs image 后缀不一致 |
| **跨层契约 mismatch** | 6 | dashboard 假定的 4 个端点（status/qr-bind/platforms/tasks）后端从未实现；heartbeat 返回 `id` vs agent 期待 `task_id`；缺 payload |
| **域名硬编码** | 1 | agent 硬编码 `api.zenithjoy.com`（死域名）→ 一直 reconnect 错误刷屏 |
| **客户机平台兼容** | 8 | .bat 文件 LF 换行闪退；UTF-8 中文 + cmd GBK 显示乱码；缺 `chcp 65001`；setlocal EnableDelayedExpansion 嵌套 if 导致 `%var%` 不展开；npm install 检查逻辑漏装新 deps；package.json 缺 playwright；agent 不读 env 而要 CLI 参数；resolveScriptPath 永远走错路径 |
| **thin/medium scope 决策不清晰** | 1 | image vs video publisher — agent 找 mp4，publisher 是 image |
| **客户体验缺失** | 4 | dashboard 不写 zj_license 到 localStorage 导致 401；agent qr-bind handler 不主动 navigate chrome；qr-bind handler 不上报 receipt；publish handler 上报 receipt 也失败 |

### 22 bug 的共同根因
**全部能在真 Windows 客户机走一次客户视角 (下载 → 解压 → 双击 .bat → 看 cmd 输出 → 用 dashboard) 抓到。** Mock smoke 抓不到任何一条，因为 mock 跳过了"客户机真环境"这一切。

---

## 硬性规则（合规检查清单）

每个 thin walking-skeleton sprint contract 必填：

- [ ] `lead_self_acceptance.worker_machine`（Tailscale hostname / ssh alias，**不写地理**）
- [ ] `lead_self_acceptance.checklist`（≥5 步，按客户视角顺序）
- [ ] `lead_self_acceptance.evidence_path`（自验完归档路径）
- [ ] **lead 真在 worker 上跑过**，evidence 文件含 cmd stdout 摘录 + 关键截图

未填或 evidence 为空 = sprint 不能 deliver 给用户测真账号。

---

## ZenithJoy 默认 worker：`xian-pc`

- 1Password 凭据：CS Vault 条目 "Xian PC (node-pc-xian)"
- ssh alias：`~/.ssh/config` 已配 `xian-pc`，直接 `ssh xian-pc` 即可
- 平台：Windows 11 Pro，含 Node 18+、Chrome 默认路径
- 用途：**仅供 lead walking-skeleton thin 自验**，不跑生产

### 隐私 / OPSEC 纪律
worker 物理位置敏感（中国电信）。在 lead 自验对话里**禁止 echo 进对话**：
- 公网 IP / `ipinfo.io` 输出 / `ipconfig` 详细输出
- 详细 hostname（如果含中文 / 含地名 → 用 `<worker>` 代替）
- timezone / locale / 系统语言
- 任何能反推地理或机器主人身份的命令输出

**对话里只用中性别名**（`xian-pc` 是中性的，但 ipinfo 输出不能复制进对话）。

---

## 自验流程模板

### Step 1：ssh 进 worker（每次 sprint 完成后）
```bash
ssh xian-pc
```

### Step 2：完整客户视角链路（按 sprint contract checklist 顺序）
示例（walking-skeleton-1 抖音 thin）：

```cmd
:: 1. 清旧的（确保 fresh 客户视角）
rd /s /q "%USERPROFILE%\Desktop\zenithjoy-agent" 2>nul
del /f /q "%USERPROFILE%\Downloads\zenithjoy-agent*.tar.gz" 2>nul

:: 2. 下载新版 tarball（用 curl，模拟客户从 dashboard 点下载）
curl -L "https://autopilot.zenjoymedia.media/download/zenithjoy-agent-vX.Y.Z.tar.gz" -o "%USERPROFILE%\Downloads\zenithjoy-agent-vX.Y.Z.tar.gz"

:: 3. 解压
cd /d %USERPROFILE%\Downloads
tar -xzf zenithjoy-agent-vX.Y.Z.tar.gz

:: 4. 双击或脚本启动 install-and-start.bat
cd zenithjoy-agent
install-and-start.bat
:: -- 跑通后看 cmd 输出至少 30 行（确认 [1/4] [2/4] [3/4] [4/4] 全 OK）
:: -- 跑完后 dashboard / 创作者后台等真业务输出端验证
```

### Step 3：归档 evidence
把 cmd stdout 关键段落 + 截图保存到：
```
.agent-knowledge/<journey-id>/lead-acceptance-<sprint>.md
```

### Step 4：sprint contract 标记 done
仅当 evidence 文件存在 + 全部 checklist 步骤通过 → contract 才能 mark `lead_self_acceptance.status: passed`。

---

## 反模式（绝对禁止）

| 反模式 | 真害处 |
|---|---|
| 拿 CI mock smoke 当 lead 自验 | 不抓客户视角断点；今天 22 bug 全是这样漏的 |
| 让用户测真账号那 1-2 步**之外**的事 | 用户当人肉测试机 = 信任崩塌 |
| ssh 进 worker 后 echo 公网 IP / hostname / timezone | 泄露机器位置，OPSEC 失败 |
| 跳过 evidence 归档直接说"我跑过了" | 不可审计 = 等于没跑 |
| sprint contract worker_machine 写"Mac mini m4"或"GitHub Actions" | 平台不对，抓不到客户机平台 bug（如 Windows .bat 闪退） |
