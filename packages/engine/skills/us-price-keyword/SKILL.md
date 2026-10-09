---
name: us-price-keyword
description: 在手机 Amazon US 与 Home Depot US 原生 App 按关键词查同型号商品价格，记录截图和 Notion 报价；适用于美国 ZIP 关键词比价，不执行购买。
---

输入英文/数字关键词、美国 ZIP（首版只支持53132，其它邮编显式拒绝）、SKU上限（默认3，范围1–3）。一次任务=一个关键词+一个ZIP+最多3个不同品牌/型号/规格组合，两平台每商品各一行报价。生产默认 openai/gpt-6-sol。Luna可通过 --model openai/gpt-6-luna 显式试运行，仅明确模型不支持时回落Sol。Luna已能完成同SKU两原生App采集和恢复，但本轮回执多次失败，尚不能称为稳定生产模型。

调度端/员工入口在控制机调用以下已部署入口；被 us-price-compare 派发的执行端仅按给定task_id采集并返回JSON，禁止再次调用CLI、创建替代任务或递归派发自己。

```bash
node /Users/administrator/openclaw-root/workspaces-root/clawd-us-price-compare/scripts/phone-rpa/us-price-keyword.mjs --keyword "cordless drill" --count 3 --zip 53132
```

CLI负责先登记Brain、派发 us-price-compare、独立校验手机XML与截图、上传Notion附件、按任务/SKU/平台幂等写入并回读。未形成全部同规格跨平台配对时报告partial，保留已有有效报价并以failed终结本轮任务，不能称整批完成或留在in_progress。执行/审计/写库失败同样failed并留原因、原证据和已写页面；claim409保持他人任务不动。实际模型取provider回执，不采用模型自行声称。

Notion员工入口：现有英文Tasks的Description填写独立行【执行参数】、执行Agent：us-price-compare、模型：openai/gpt-6-sol、【执行参数结束】，随后独立行关键词：英文关键词、数量：1、邮编：53132；Status改Delegated才提交。不要填写Workflow关系。已部署watcher每次仅GET回灌的queued qiumi_task，明确同Agent后用CLI --task-id认领原任务，不另建任务、不调用dispatch；显式人类lane、人工暂停、未来排期不执行。运维由launchd定时启动绝对路径 `/Users/administrator/openclaw-root/workspaces-root/clawd-us-price-compare/scripts/phone-rpa/us-price-notion-watch.mjs --once`，单实例不可重叠；执行端不运行watcher。报价写独立业务库，summary把任务编号、商品/报价数量和明细库链接回流原任务。

执行端：XIAN-M4-PHONE小黄ANGYVB4402004137，controller `/Users/jinnuoshengyuan/.local/bin/douyin-phone-adb --profile legacy`。整个任务只启动一次固定dispatcher，由dispatcher内部唯一with-lock包住一个Python worker，禁止逐动作重新with-lock。被派发的采集端仅执行CLI给定base64请求，不自行改写脚本/证据目录。固定node脚本为 `/Users/jinnuoshengyuan/Library/Caches/us-price-native-staging/runtime/us_price_native_worker.py`，同目录依赖native_price_phone.py。确认空闲后按用户授权决策043693f2-c703-406b-96c6-90a0176eff0b切mac-mini-m4-us；结束或失败都恢复None/国内、HOME并释放锁；不改变小彩。已有锁或原出口与约定不符则停止。

只用 `com.amazon.mShop.android.shopping`、`com.thehomedepot` 原生前台。Home Depot先设ZIP/门店再App内搜索和点击商品，外部商品深链可能Error Page。Amazon按型号页面就绪等待，不以固定冷启动延时断言失败；拒绝可选读取应用列表权限。禁止网页采价、注册登录、购买或加车。

worker先在HomeDepot搜关键词发现商品候选，清空残留搜索，精确识别搜索框而非Image Search；拒绝两App可选读取应用列表权限。动态读取Model#/Internet#，再Amazon原生搜索同型号，每SKU最多2候选、每页最多5轮。商品链接可null并记商品链接未采集，不为ASIN额外翻页或读剪贴板。模型只根据紧凑price_candidates上下文判断默认新货标价、分类与同套装canonical specification；不取信用卡优惠、分期或最低候选。然后核对品牌、型号和规格套装；不同电池/配件不能算同SKU。每报价保存型号/价格/ZIP原生XML、截图绝对路径、采集ISO时间及action_owner。运费税费未查清写未知，缺价不填0，不复用旧报价。

node_exec使用已验证的timeoutSeconds参数：count1=600，count2..3=1000，不猜字段。node_exec调用结果用text(r)完整返回，不要猜r.content或遍历r.content以免丢失非MCP结果。证据处理优先node_exec在设备解析XML并返回紧凑字段/结构化结果，Android UI文本在属性中，应遍历root.iter()读取node.get('text','')和node.get('content-desc','')，不是itertext；控制器直接使用已给绝对路径，无需寻找，不要把shell控制器当python运行。禁止把全文XML返回模型。同一证据最多读取1次，截图存在后返回路径供CLI独立审计上传，不要调用file_fetch反复拉图。恢复网络/桌面并释放锁后立即输出JSON，不继续读取已验收证据。

返回CLI提示词规定的JSON报价结构，附network_restored/home_verified/lock_free_verified验收。失败报实际原因与已做动作，不伪造成功。

能力边界：同型号单SKU原生路径已验收；Luna业务与3SKU批量结果以各任务真实回执为准，不能从单SKU通过推断所有关键词稳定。

锚点：Brain任务f6bc3cf0-b931-4c17-872d-cba140837461；报价库7452049ef7de4da5822d4ff682869172；数据源81b9a684-bc40-44dd-840b-235e56296bd3。
