## 本轮 Codex 预览传输边界（HTTP + browser）

控制器核对本 PR head 与预览 health.git_sha，给 curl 配置专用 Unix socket。保持正常 `curl PREVIEW_URL/api/...` 命令：CURL_HOME 中的只读配置负责传输，桥只把请求送到本轮固定预览。报告原样记录真实命令和输出，不把 socket 路径或临时配置写进命令。

页面验收使用控制器提供的只读 Playwright helper，勿直接启动普通 Chromium（macOS 沙箱会拒绝其多进程 Mach 注册）。在 SHOTS_DIR 编写 `qa-playwright.cjs`，用真实原生命令 `node <SHOTS_DIR>/qa-playwright.cjs` 执行，保留断言失败的非零退出码及截图：

```js
const { launchPreviewBrowser } = require(process.env.CODING_WF_PREVIEW_BROWSER_HELPER);
const browser = await launchPreviewBrowser();
try {
  const context = await browser.newContext(); // 每个 Q-n 必须全新上下文，不传 storageState
  const page = await context.newPage();
  await page.goto('本轮真实 PREVIEW_URL');
  // 实际点击、输入、可见断言；截图存 SHOTS_DIR，报告写相对 SPRINT_DIR 的截图路径。
  console.log(JSON.stringify(browser.diagnostics()));
} finally { await browser.close(); }
```

CommonJS 顶层请用 async 函数包裹并在 catch 中置 process.exitCode=1。helper 每次 newContext 用 pipe 启动独立的单进程 Chromium，完整 HTTP 请求经同一个固定预览桥，保持真实页面/JS/API 行为；不使用 mock、setContent 或伪造响应替代页面。报告命令与输出仍须匹配本轮原生执行事件。

TCP 网络、其他预览端口和外网不开放。不要改 CURL_HOME/helper、覆盖 curl 配置、启动代理/SSH/CDP端口或用备用工具绕过限制。禁止修改 helper 路由或另开未受控上下文。helper 的 `diagnostics()` 会记录跨源阻止、WebSocket 不支持和传输错误，请把涉及验收的限制原样留证。

Service Worker 被禁用，WebSocket/跨源第三方资源尚不支持。若 Q-n 依赖这些能力、浏览器依赖缺失/启动失败或其他无法执行的条件，保留原要求并写 CANNOT_VERIFY 与具体原因；不能用 API、源码或本地假页面替代 UI 验收，也不能把工具缺口改成 PASS。已支持的普通同源 HTTP 页面必须实际打开、操作并截图，不再以“Codex 无浏览器”跳过。
