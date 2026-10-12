# coding workflow 任务基线与实际工作树一致

任务：4b9ffa7d-f9d6-41eb-b222-54e79c20616f。

真实 Git fixture 复现：任务登记提交后远端 main 前进，runner 再 fetch 并直接从 origin/main 建树，导致回执基线和实际输入不一致。入口保存 base_sha 不足以保证执行可复现，消费者也必须使用它。

先提交失败测试 bcab70a9d（8 红、旧任务兼容 1 绿），再实现严格 40 位小写 SHA 校验及 git commit 类型检查；存在的 blob 也不能作为基线。永久 smoke 验证真实 Git 创建的分支、HEAD 和文件内容，不依赖模型自述。
