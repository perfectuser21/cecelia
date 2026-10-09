---
name: us-price-keyword
description: 在手机 Amazon US 与 Home Depot US 原生 App 按关键词查同型号商品价格，记录截图和 Notion 报价；适用于美国 ZIP 关键词比价，不执行购买。
---

输入关键词、美国五位 ZIP（默认53132）、SKU上限（默认3，范围1–3）。一次任务=一个关键词+一个ZIP+最多3个不同品牌/型号/规格组合，两平台每商品各一行报价。模型优先 openai/gpt-6-luna；仅明确模型不支持时降至 openai/gpt-6-sol。

调度端/员工入口在控制机调用以下已部署入口；被 us-price-compare 派发的执行端仅按给定task_id采集并返回JSON，禁止再次调用CLI、创建替代任务或递归派发自己。

```bash
node /Users/administrator/openclaw-root/workspaces-root/clawd-us-price-compare/scripts/phone-rpa/us-price-keyword.mjs --keyword "cordless drill" --count 3 --zip 53132
```

CLI负责先登记Brain、派发 us-price-compare、独立校验手机XML与截图、上传Notion附件、按任务/SKU/平台幂等写入并回读。未形成全部同规格跨平台配对时报告partial，保留已有有效报价，不能称整批完成。实际模型取provider回执，不采用模型自行声称。

执行端：XIAN-M4-PHONE小黄ANGYVB4402004137，controller `/Users/jinnuoshengyuan/.local/bin/douyin-phone-adb --profile legacy`。全程一个with-lock owner，确认空闲后按用户授权决策043693f2-c703-406b-96c6-90a0176eff0b切mac-mini-m4-us；结束或失败都恢复None/国内、HOME并释放锁；不改变小彩。已有锁或原出口与约定不符则停止。

只用 `com.amazon.mShop.android.shopping`、`com.thehomedepot` 原生前台。Home Depot先设ZIP/门店再App内搜索和点击商品，外部商品深链可能Error Page。Amazon按型号页面就绪等待，不以固定冷启动延时断言失败；拒绝可选读取应用列表权限。禁止网页采价、注册登录、购买或加车。

先搜关键词发现候选，然后核对品牌、型号和规格套装；不同电池/配件不能算同SKU。每报价保存型号/价格/ZIP原生XML、截图绝对路径、采集ISO时间及action_owner。运费税费未查清写未知，缺价不填0，不复用旧报价。

证据处理优先node_exec在设备解析XML并返回紧凑字段/结构化结果，Android UI文本在属性中，应遍历root.iter()读取node.get('text','')和node.get('content-desc','')，不是itertext；控制器直接使用已给绝对路径，无需寻找，不要把shell控制器当python运行。禁止把全文XML返回模型。同一证据最多读取1次，截图存在后返回路径供CLI独立审计上传，不要调用file_fetch反复拉图。恢复网络/桌面并释放锁后立即输出JSON，不继续读取已验收证据。

返回CLI提示词规定的JSON报价结构，附network_restored/home_verified/lock_free_verified验收。失败报实际原因与已做动作，不伪造成功。

能力边界：同型号单SKU原生路径已验收；Luna业务与3SKU批量结果以各任务真实回执为准，不能从单SKU通过推断所有关键词稳定。

锚点：Brain任务f6bc3cf0-b931-4c17-872d-cba140837461；报价库7452049ef7de4da5822d4ff682869172；数据源81b9a684-bc40-44dd-840b-235e56296bd3。
