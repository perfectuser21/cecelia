---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 7
回归风险: 8
可执行: 7

## 上轮问题
- R-1: 关闭 —— S-2 已要求从安装时的 `CODING_WF_USER_HOME` 或已安装 plist 的 `StandardOutPath` 定位日志，Q-3 增加了 `/Volumes/runner-home` 对照案例；与 `install.sh` 的 `LOG_FILE` 生成方式一致。

### R-2
针对: S-3, Q-5, I-3
严重度: 重要
场景: 真人 QA 在受控 Codex 会话中照 Q-5 直接请求 `<预览环境>/api/brain/health`，却无法连接预览端口，于是拿不到 SHA，不能完成该场景要求的同 head 核对。
依据: `packages/brain/scripts/coding-workflow/lib/codex-session.mjs` 的 `prepareCodexSession` 在预览模式只放行能力绑定的 Unix socket，网络权限不开放直连预览端口；`lib/preview-bridge.mjs` 为此写入 `CURL_HOME` 的 `.curlrc`，`lib/preview.mjs` 的预览地址是 `localhost:<port>`。Q-5 只写了 `<预览环境>` 直接 GET，没有写经现有桥接能力发请求的可执行步骤。
说明: Q-5 应按真实 QA 的传输形状给出通过 `CURL_HOME` 和绑定的同源地址读取 health 的操作，以及未获预览能力或预览未就绪时的结论；保持本任务不新启浏览器或生产会话的边界。
