### 根本原因

WS2 需产出三类证据文件：contract-review-feedback.md（含三元组+YES触发REVISION）、cp-harness-propose-r2-* 远端分支（证明GAN R2执行）、sprint-contract.md（最终APPROVED含三元组NO）。sprint-contract.md 的 Feature 描述文字中含有字面量 `能否绕过: YES`（如描述规则的说明文字），导致 YES=0 验证失败。

### 下次预防

- [ ] 生成 sprint-contract.md 前先扫描所有 Feature 描述/硬阈值文字，用 `grep '能否绕过[：:]\s*YES'` 确认无字面量命中
- [ ] 三元组的 `命令:` 字段必须包含真实草案的 readFileSync 路径（确保路径指纹匹配，避免 fingerprintMismatches > 30%）
- [ ] sprint-contract.md 的 `---` 分隔符仅用于三元组分隔，Feature 描述内不要引入额外 `---`
