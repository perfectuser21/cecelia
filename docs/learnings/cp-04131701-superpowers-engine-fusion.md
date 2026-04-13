## 融入 Superpowers 到 Engine /dev Pipeline（2026-04-13）

### 根本原因
Engine 的 step 文件（01-spec.md, 02-code.md, 03-integrate.md）只有流程骨架，缺少行为纪律细节。02-code.md 仅 116 行，agent 在 Stage 2 里"怎么写代码、怎么调试、怎么验证"几乎没有指导。Superpowers 插件提供了完整的 TDD 红绿循环、Verification Gate、Systematic Debugging 等模板，两者互补。

### 下次预防
- [ ] 新增 skill/step 文件时，检查是否有现成的开源 skill 可以直接引用，避免从零造轮子
- [ ] step 文件改动后，对比 Superpowers 同类 skill 的内容深度，确保不低于行业标准
- [ ] 定期更新 Superpowers 插件版本（`claude plugins update superpowers`）
