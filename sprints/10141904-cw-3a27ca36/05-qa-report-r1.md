---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

本轮只读核对交接手册与本 PR 检出的实现；未执行安装、账号调用、服务变更或生产访问。Q-5、Q-6 各使用全新浏览器上下文打开本轮预览根页并截图。预览根页实际显示 Brain 状态 JSON。

### T-1
对应: Q-1
verdict: PASS
说明: 手册示例指定 Codex 订阅 home、开发与裁判的不同模型，以及仅 `cecelia` 的安装变量。人工对照 `install.sh` 的默认值、`runtime-install.mjs` 的 disabled 门和 `repos.json` 的仓库开关；dry-run 与正式 sudo 安装的区别写明。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["CODING_WF_PROVIDER=codex","CODING_WF_CODEX_MODEL=gpt-6-sol","CODING_WF_JUDGE_PROVIDER=codex","CODING_WF_JUDGE_MODEL=gpt-6-astra","CODING_WF_REPOS=cecelia","--dry-run","runtime_install_disabled"])if(!s.includes(x))throw Error(x);console.log("安装手册核对通过")'
```
```output
安装手册核对通过
```

### T-2
对应: Q-2
verdict: PASS
说明: 按 disabled、账号失效、并发和旧锁四种情形判读手册：均要求停止并核实现场；没有临时启用、自动换 API key/Claude 或按年龄删锁的恢复指令。对照安装器、健康检查和安装前锁守卫的源码。
```command
node -e 'const f=require("fs"),r=f.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),i=f.readFileSync("packages/brain/scripts/coding-workflow/runner/runtime-install.mjs","utf8"),h=f.readFileSync("packages/brain/scripts/coding-workflow/runner/runtime-health.mjs","utf8"),g=f.readFileSync("packages/brain/scripts/coding-workflow/runner/runtime-install-guard.mjs","utf8");for(const x of ["runtime_install_disabled","不能临时绕过禁用门","不改用 API key、其他账号或 Claude","不按年龄删除","核对锁目录的 PID"])if(!r.includes(x))throw Error(x);for(const [s,x] of [[i,"runtime_install_disabled"],[h,"Logged in using ChatGPT"],[g,"runtime_install_lock_unknown"]])if(!s.includes(x))throw Error(x);console.log("禁用、账号、锁恢复说明与源码一致")'
```
```output
禁用、账号、锁恢复说明与源码一致
```

### T-3
对应: Q-3
verdict: PASS
说明: 手册含健康命令、system 域检查、回执与日志查询。按文档案例，`CODING_WF_USER_HOME=/Volumes/runner-home` 对应主日志 `/Volumes/runner-home/Library/Logs/coding-workflow-runner.log`；已安装机器可用 plist 的 `StandardOutPath` 核对。对照 plist 模板、安装器、健康脚本与状态脚本；新建空回执目录实际返回空数组，手册没有把它称为服务健康。
```command
node -e 'const f=require("fs"),r=f.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),t=f.readFileSync("packages/brain/scripts/coding-workflow/runner/com.cecelia.coding-workflow-runner.plist.tmpl","utf8");for(const x of ["launchctl print system/com.cecelia.coding-workflow-runner","launchctl print-disabled system","status.mjs --json","runtime-health.mjs","/Volumes/runner-home/Library/Logs/coding-workflow-runner.log","plutil -extract StandardOutPath","tail -n 100","ok:true","authentication:"])if(!r.includes(x))throw Error(x);if(!t.includes("StandardOutPath")||!t.includes("StandardErrorPath"))throw Error("plist log paths");console.log("健康、system 与自定义日志位置说明存在")' && node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir sprints/10141904-cw-3a27ca36/qa-r1/status-empty --json
```
```output
健康、system 与自定义日志位置说明存在
[]
```

### T-4
对应: Q-4
verdict: PASS
说明: 脏工作区、本地 ahead/分叉、心跳文件冲突时，手册要求停止并保留现场；旧锁须核对 PID、进程、launchctl 与任务。对照 `runtime-update.mjs` 的白名单正则、祖先检查、冲突检查及仅快进更新，以及 `runtime-lock.mjs`、`runtime-launch.mjs` 的锁用法。首次尝试的否定正则误把“**不执行** git reset”识别为建议，已修正断言后重跑；产品行为没有因此判错。
```command
node -e 'const f=require("fs"),r=f.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),u=f.readFileSync("packages/brain/scripts/coding-workflow/runner/runtime-update.mjs","utf8");for(const x of [".cecelia/hb.sh","<安全文件名>.live","git merge --ff-only","本地 ahead 或分叉","不按年龄删除","核对锁目录的 PID","不执行 `git reset --hard` 或 `git clean`"])if(!r.includes(x))throw Error(x);for(const x of [".cecelia/hb.sh","[a-zA-Z0-9][a-zA-Z0-9._-]*","--is-ancestor","--ff-only","runtime_collision"])if(!u.includes(x))throw Error(x);console.log("脏工作区、快进、心跳白名单和旧锁说明一致")'
```
```output
脏工作区、快进、心跳白名单和旧锁说明一致
```

### T-5
对应: Q-5
verdict: PASS
说明: 预览 health 的 40 位 SHA 与本 PR 检出 HEAD `6746ab4cc458414a29e5e913cb00cb11d3e641f1` 相同。手册对 `CURL_HOME` Unix 桥、同源 HTTP、隔离浏览器、跨源重定向及 WS/SW 的 `CANNOT_VERIFY` 边界，与 `activities/evaluate.mjs`、`lib/preview-bridge.mjs`、`lib/preview-browser.mjs`、`lib/codex-session.mjs` 一致。浏览器以新上下文真实打开预览根页；诊断为空。截图: qa-r1/q-5-preview.png
```command
PREVIEW_URL=http://localhost:5301; EXPECTED_SHA=$(git rev-parse HEAD); curl -fsS "$PREVIEW_URL/api/brain/health" | jq -e --arg sha "$EXPECTED_SHA" 'if .git_sha == $sha then {git_sha,status} else error("preview SHA mismatch") end' && node sprints/10141904-cw-3a27ca36/qa-r1/qa-playwright.cjs
```
```output
{
  "git_sha": "6746ab4cc458414a29e5e913cb00cb11d3e641f1",
  "status": "healthy"
}
Q-5: HTTP 200, title="", body="{\"service\":\"cecelia-brain\",\"status\":\"running\",\"port\":\"5301\"}", screenshot=q-5-preview.png
Q-6: HTTP 200, title="", body="{\"service\":\"cecelia-brain\",\"status\":\"running\",\"port\":\"5301\"}", screenshot=q-6-preview.png
[]
```

### T-6
对应: Q-6
verdict: PASS
说明: 手册写出专用 Playwright 1.62.1 目录、clone 链接、lock integrity 检查及会实际启动并关闭 Chromium 的命令，明确缺依赖时停止浏览器验收；没有声称本次已执行手册中的依赖安装或维护用启动检查。对照 `lib/preview-browser.mjs` 与 `repos.json`、`runner/lib/merge-gate.mjs`，ZenithJoy 的人工合并和 PR #2132 待处理边界仍在。另用本轮受控 helper 新上下文打开预览根页并截图，仅验证 QA 截图通道。截图: qa-r1/q-6-preview.png
```command
node -e 'const f=require("fs"),r=f.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"),j=JSON.parse(f.readFileSync("packages/brain/scripts/coding-workflow/repos.json","utf8")),b=f.readFileSync("packages/brain/scripts/coding-workflow/lib/preview-browser.mjs","utf8");for(const x of ["playwright-1.62.1/node_modules","playwright-core","package-lock.json","integrity","--single-process","--no-zygote","preview_browser_unavailable","PR #2132","automerge=false","人工放行"])if(!r.includes(x))throw Error(x);if(!b.includes("--single-process")||!b.includes("preview_browser_unavailable"))throw Error("browser source");if(!JSON.stringify(j).includes("\"automerge\":false"))throw Error("automerge");console.log("浏览器前置与人工放行说明存在")' && node sprints/10141904-cw-3a27ca36/qa-r1/qa-playwright.cjs
```
```output
浏览器前置与人工放行说明存在
Q-5: HTTP 200, title="", body="{\"service\":\"cecelia-brain\",\"status\":\"running\",\"port\":\"5301\"}", screenshot=q-5-preview.png
Q-6: HTTP 200, title="", body="{\"service\":\"cecelia-brain\",\"status\":\"running\",\"port\":\"5301\"}", screenshot=q-6-preview.png
[]
```

### X-1
对应: Q-5
场景: 用户请求不存在的同源 API 路径，预览明确返回 404；没有把未知路由误判成成功。
verdict: PASS
```command
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:5301/api/brain/nonexistent-qa-route | grep -x 404
```
```output
404
```
