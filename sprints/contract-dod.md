---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Cecelia Dashboard 首页固定状态标识文字

**范围**: 在 `apps/dashboard/src/App.tsx` 认证后布局区域插入静态文字元素 `Cecelia Harness 工厂线已贯通`，带 `data-testid="harness-status-banner"`，Playwright 可见且在初始视口内
**大小**: S

---

## Risks

| # | 风险 | Mitigation |
|---|---|---|
| R1 | E2E 依赖 localhost:5174 已就绪 | curl 前置守卫（curl -sf http://localhost:5174 失败 = FAIL，不兜底）；已在 contract-draft.md E2E 脚本第 0 步显式登记 |
| R2 | dark mode 对比度不足（WCAG AA < 4.5:1）| Generator 须在 dark: class 下设满足 WCAG AA 颜色；evaluator 从截图 04-dark-mode.png 视觉核查 |

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/App.tsx` 含目标文字字符串
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('Cecelia Harness 工厂线已贯通'))process.exit(1)"

- [ ] [ARTIFACT] `apps/dashboard/src/App.tsx` 含 `data-testid="harness-status-banner"`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.includes('data-testid=\"harness-status-banner\"'))process.exit(1)"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] App.tsx 源码包含目标文字且为静态硬编码（非异步获取）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/App.tsx\",\"utf8\");if(!c.includes(\"Cecelia Harness 工厂线已贯通\")){console.error(\"FAIL: 文字不存在\");process.exit(1);}const eff=(c.match(/useEffect\\\\([^)]*=>[^)]*\\\\)/gs)||[]);if(eff.some(b=>b.includes(\"Cecelia Harness 工厂线已贯通\"))){console.error(\"FAIL: 文字在 useEffect 内\");process.exit(1);}console.log(\"OK\");" || exit 1'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] App.tsx 含 data-testid="harness-status-banner"（Playwright 定位锚点存在）
  Test: manual:bash -c 'grep -q "data-testid=\"harness-status-banner\"" apps/dashboard/src/App.tsx || { echo "FAIL: testid 不存在"; exit 1; }; echo OK'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] 文字元素在认证后布局（isAuthenticated && 门控内）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/App.tsx\",\"utf8\");const idx=c.indexOf(\"harness-status-banner\");const before=c.slice(0,idx);if(!before.includes(\"isAuthenticated\")){console.error(\"FAIL: banner 不在 isAuthenticated 门控内\");process.exit(1);}console.log(\"OK\");" || exit 1'
  期望: OK（exit 0）

- [ ] [BEHAVIOR] 全 Golden Path Playwright 验证（文字可见 + 在视口内 + 精确匹配）
  Test: manual:bash -c 'node -e "
const {chromium,expect}=require(\"@playwright/test\");
(async()=>{
  const b=await chromium.launch({headless:true});
  const p=await b.newPage();
  await p.goto(\"http://localhost:5174\");
  await p.waitForLoadState(\"networkidle\");
  const el=p.getByTestId(\"harness-status-banner\");
  await el.waitFor({timeout:10000});
  const txt=await el.textContent();
  if(txt!==\"Cecelia Harness 工厂线已贯通\"){console.error(\"FAIL text:\",txt);process.exit(1);}
  const iv=await el.isInViewport();
  if(!iv){console.error(\"FAIL: not in viewport\");process.exit(1);}
  await b.close();
  console.log(\"OK\");
})().catch(e=>{console.error(\"FAIL:\",e.message);process.exit(1);});"'
  期望: OK（exit 0）

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path，截图可视化验证
  Screenshots:
    - 01-initial.png      期望：访问首页后初始状态，Dashboard 正在加载/已加载，顶部导航或侧边栏可见
    - 02-layout.png       期望：认证后布局渲染完成，侧边栏 `aside` 元素可见
    - 03-banner-visible.png  期望：固定状态文字 'Cecelia Harness 工厂线已贯通' 可见，位于页面顶部区域
    - 04-dark-mode.png    期望：deep dark 模式下文字元素仍存在于 DOM 且可见
  路径格式: sprints/screenshots/<step>.png
  期望: evaluator 完成后截图已复制到 sprints/screenshots/ 目录
