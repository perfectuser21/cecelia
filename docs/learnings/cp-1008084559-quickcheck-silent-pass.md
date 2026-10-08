## pre-push quickcheck 找不到 vitest / 拿不到锁时静默放行（2026-10-08）

### 根本原因

- `scripts/quickcheck.sh` 在改动包找不到 vitest 二进制时打印"vitest 未安装，跳过"后照样通过；拿不到锁 2 秒就 `exit 0`。两条都是"检查不了就当通过"。
- 10-01 本机一次 npm 安装中断，brain 的 zod、vitest 等成了空目录；此后一周 brain 改动的 push 从未真跑测试。主仓 packages/engine 也从未装 vitest，engine 改动同样一直被"跳过"。
- 失败被静默吞掉，没人察觉，直到盘点本机环境才发现。

### 下次预防

- [ ] 守卫"做不到检查"时一律判失败，跳过必须是显式开关并醒目提示
- [ ] 锁冲突用"等待 + 超时失败"，不用"跳过"；mkdir 锁要能回收陈旧锁
- [ ] bash 中变量后紧跟中文标点必须写成 `${VAR}`（本次又踩一次 `$PKG，` 被解析成变量名）
