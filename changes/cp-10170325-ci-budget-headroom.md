### {VERSION} — CI 有界预算与有效金标集评分

integration任务预算20→30分钟，Smoke Glob Runner30→45分钟；所有测试、回调及必需聚合失败传播保留。goldset默认使用已原图实测可用的gpt-5.6-sol-official，解析失败不再给负标签错误加分；原10PNG/0.9阈值与显式模型覆盖不变。永久真实子进程/本地HTTP回归已红绿验证；固定HEAD完整CI及真实模型结果另行核验，旧失败不追认。
