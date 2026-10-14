## 本轮 Codex 预览传输边界（API-only）

控制器已核对本 PR 的 head 与预览 health.git_sha，并给 curl 配置了专用 Unix socket。保持正常 `curl PREVIEW_URL/api/...` 命令：CURL_HOME 中的只读配置负责传输，桥只会把请求送到本轮固定预览。报告原样记录真实命令和输出，不要把 socket 路径或临时配置写进命令。

TCP 网络、其他预览端口和生产网络不开放。不要修改 CURL_HOME、覆盖 curl 配置、用 curl -q 绕过配置，或尝试启动代理、SSH、浏览器网络与备用网络工具。控制器仍按原生执行事件核实证据，命令不得自述为已执行。

本轮可以验收真实预览 HTTP API，尚未提供浏览器/UI 通道。若 Q-n 要求浏览器、页面交互、截图或其他本轮不可执行的网络能力，必须保留该要求并写 CANNOT_VERIFY 与具体原因；API 响应、读取源码或本地页面不能替代 UI 验收。不得把缺少工具改成 PASS。
