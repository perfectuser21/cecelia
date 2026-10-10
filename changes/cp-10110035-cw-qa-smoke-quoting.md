## Brain {VERSION} — coding harness：QA 验收命令固化的 smoke 不再假通过

- 金丝雀 4 第 3 轮独立裁判 J-4 发现，runner 固化的 cw-bd2b1556-qa-smoke.sh 有两个问题：
  - 单引号里的预览地址被替换成 '"$BRAIN_URL"/api…'，变量不展开，请求根本没打到 Brain；
  - 每个 T-n 是一条 && 断言链，set -e 不会因为链中途失败而退出，断言失败了脚本照样打印 PASS。
- 修法：
  - 预览地址按所在的引号上下文替换：单引号里写 '"$BRAIN_URL"'，双引号里写 $BRAIN_URL，引号外写 "$BRAIN_URL"；
  - 每个 T-n 包进子 shell，退出码非 0 就输出 FAIL: T-n 并让脚本退出 1；
  - evaluate prompt 要求每条命令的整体退出码代表结论。
- 测试：新增两条真跑生成脚本的用例（用假 curl 回显收到的地址），覆盖三种引号上下文都能展开，以及断言链中途失败时脚本非 0 退出、不打印 PASS。
