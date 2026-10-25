## 快照发布运输期限（2026-10-25）

### 根本原因
实际GHA在300.315秒收到UND_ERR_HEADERS_TIMEOUT，而中央冷刷新稍后完成。AbortSignal的600秒总期限不覆盖Undici默认headers/body期限。旧发布器对transport错误闭口，既有409赢家处理不覆盖这类UNKNOWN。

### 下次预防
- [x] 先以Node22真实HTTP缩时headers/body回归取得具体超时RED，再显式配置私有Agent，不借全局dispatcher或Node私有实现。直接依赖精确锁定undici6.29.1，Node22受支持且包含近期安全修复。
- [x] Node22首版固定字节本地完整入口264/264通过（该首版随后正式CI失败，见下节）；回归保留总deadline失败、原POST次数、完整验证和清理错误路径；失败不能等待graceful close，destroy失败不能覆盖原异常，包括undefined。
- [ ] 正式CI、正常合并和main正式发布尚待独立验收；不把本地测试或旧赢家回读计作新样本成功。

任务427d7e49-27c5-4612-b115-9214f03d47f9，actor=codex-headed-cw-reliability。仅开发事件附件，不替代Brain真身或冻结C01–C12。

### 正式CI暴露的响应体中断缺口
首版16c9在Linux正式CI为263通过、1失败：同一POST总计时器10秒已触发，实际响应体12秒才读完；读体后检查虽拒绝发布，却没有保证当时就关闭连接。native fetch内部该次为何没有中断仍未知，不能将弱引用当已证根因。该正式失败及本地无效夹具、先前所有RED继续保留。

- [x] 新真实HTTP故障注入保留实际socket与计时器，只隔离native signal传递；先获得10秒超时却14秒才关闭的RED，再在原signal触发时主动销毁本发布私有dispatcher。清理promise创建即处理拒绝，每次request结束移除监听，旧GET计时器不能中断后续POST；不增加预算或请求次数。
- [x] 修正后10个HTTP/清理测试和35个既有发布器回归通过；故障注入中本次signal后1ms关闭socket，仅1次POST、UNKNOWN且无正式产物；晚读体完成事实仍如实记录。该本地结果仍不覆盖新的正式CI。
