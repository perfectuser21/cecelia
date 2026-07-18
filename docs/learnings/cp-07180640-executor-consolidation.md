# Learning: 执行体决策收权（刀2a）

### 根本原因
`triggerCeceliaRun` 的执行体选择散在 9 段 if 链，每段一个 return trigger*。三轴分配器想加"按余额×档位×机器选执行体"时无处插座——对抗审查 REJECT：硬插就是第 10 个决策脑子（和洗 claim/直落 main/容器抢跑同类病：多个自治写者动共享决策）。

### 下次预防
- [ ] 加新的派发/选择通道前，先把散落的同类判定收权成一个纯决策函数（beeba317 收 harness cap 入 slot-allocator 同款手法）
- [ ] 收权=纯重构必须逐段行为等价审查（决策与派发分离：条件抽纯函数，副作用留主体），任何语义漂移是 blocker
- [ ] 纯决策函数注入依赖（getCachedLocation 等）便于单测，锁死"同输入同输出无 IO"
