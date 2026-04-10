### 根本原因

Harness pipeline 的 GAN Reviewer 做的是静态审查（"这命令看起来够严格"），
不是真正的对抗证伪。官方 Anthropic 明确踩过这个坑：Evaluator 发现问题后
会说服自己"不是大问题"然后 APPROVE，导致 GAN 形同虚设。

根本问题：Reviewer 没有对立激励，没有被强制构造反例。

### 下次预防

- [ ] Reviewer 审查时必须对每条命令写出"最懒假实现 + 能否绕过"
- [ ] 任何 `能否绕过: YES` 必须 REVISION，不允许主观豁免
- [ ] harness_evaluate task_type 已废弃，不要在新 skill 里引用 eval-round-N.md
- [ ] harness-report 不再有 Evaluator 列
