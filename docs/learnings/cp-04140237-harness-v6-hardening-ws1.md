### 根本原因

harness_evaluate verdict 读取无重试机制：agent 写 verdict 存在 DB 延迟，单次读取偶发空值，导致评估阶段误判为 FAIL 并触发不必要修复。bridge session 崩溃（0 字节输出）缺乏专属识别，被混同为普通 pr_url 缺失，错误创建 harness_fix 而非 harness_evaluate 重试。

### 下次预防

- [ ] DoD 测试命令不能包含目标文件路径以外的字符串模式（避免注释内容触发假阳性）
- [ ] 新增 execution helper 模块时，检查 DoD 的字符串搜索范围（substr offset+800），确保注释不混入被禁止的词
- [ ] verdict_timeout / session_crashed / permanent_failure 三态的 800 字节窗口内不得含被禁词（harness_fix 等）
