# Dashboard 部署判变 SHA 对账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** deploy-local.sh 的 dashboard 判变改为"生产自报 build-info.json SHA 对账"，promote 的 HK 同步/终验从 warning 升 fatal，根治"merge 了但静默没上线"。

**Architecture:** 与 Brain SHA 对账（deploy-local.sh:78-96）同构：vite 构建把 GIT_SHA 烙进产物 `build-info.json`，判变时问真容器自报 sha 与 origin/main 做路径过滤 diff。promote 改造现有 HK rsync/指纹校验段（不写平行逻辑），指纹校验优先比 build-info sha。

**Tech Stack:** bash（set -uo pipefail，禁 jq、解析用 node -e）、vite 内联插件（generateBundle + emitFile）。

**Spec:** `docs/superpowers/specs/2026-07-18-deploy-sha-reconcile-design.md`

**关键背景（执行者必读）：**
- 部署根守卫每次 `reset --hard origin/main`，所以 `git diff origin/main...HEAD` 在专用部署根恒空——这就是要修的 bug。
- build-info.json 404 时 SPA fallback 返 **200+HTML 而非 404**（frontend-proxy.js 行为），`curl -f` 抓不住，必须靠 JSON 解析失败兜底。
- 测试钩子体系：`CECELIA_DEPLOY_ROOT`（隔离部署根）、`CECELIA_PROD_GIT_SHA`（Brain 生产 sha 注入，**禁复用**——会连带 NEED_BRAIN 在 fixture 根炸 brain-deploy.sh）、`STAGING_FIXTURE_DIST`（跳过真 build）、`CECELIA_SKIP_HK` / `CECELIA_SKIP_BRAIN_PROMOTE` / `CECELIA_SKIP_FINGERPRINT`（promote 跳过段）。新钩子 `CECELIA_PROD_DASHBOARD_SHA` 与它们同构。
- worktree 内禁 npm install/build；vite 插件的真实构建验证交给 workspace CI。
- `scripts/smoke/*-smoke.sh` 命名自动进 ci.yml 的 glob smoke job，**勿动 ci.yml**。

---

### Task 1: failing smoke（commit-1，必须先红）

**Files:**
- Create: `scripts/smoke/dashboard-sha-reconcile-smoke.sh`

- [ ] **Step 1: 写 failing smoke**

```bash
#!/usr/bin/env bash
# dashboard-sha-reconcile-smoke.sh — deploy-local.sh dashboard 判变"生产自报 SHA 对账"回归守卫
#
# 病根（2026-07-18，issue 89079934）：专用部署根 reset --hard origin/main 后
# git diff origin/main...HEAD 恒空 → dashboard 改动永远判"无改动"静默跳过（#4022/#4038 实证）。
# 本 smoke 用 CECELIA_PROD_DASHBOARD_SHA 注入"生产落后"场景，断言判变触发 Dashboard 构建。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$REPO_ROOT/scripts/deploy-local.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
pass(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
fail(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 隔离 fixture 仓：commit1 = base，commit2 只改 apps/dashboard/x.txt。
# 不配 origin —— deploy-local 的 ref 解析须回退本地 main（Brain 对账因 ORIGIN_SHA 空自动跳过）。
new_fixture() {
  local R="$TMP/repo-$RANDOM"
  mkdir -p "$R"
  git -C "$R" init -q -b main
  git -C "$R" -c user.email=t@t.t -c user.name=t commit -q --allow-empty -m base
  mkdir -p "$R/apps/dashboard"
  echo x > "$R/apps/dashboard/x.txt"
  git -C "$R" add -A
  git -C "$R" -c user.email=t@t.t -c user.name=t commit -q -m "dash change"
  echo "$R"
}

R=$(new_fixture)
C1=$(git -C "$R" rev-parse HEAD~1)
C2=$(git -C "$R" rev-parse HEAD)

echo "[1] 生产 sha 落后且改动在 apps/dashboard → 必须触发 Dashboard 构建"
OUT=$(cd "$R" && CECELIA_DEPLOY_ROOT="$R" CECELIA_PROD_DASHBOARD_SHA="$C1" bash "$DEPLOY" --dry-run 2>&1) || true
if echo "$OUT" | grep -q "Dashboard 改动"; then
  pass "判变触发 Dashboard 构建"
else
  fail "未触发 Dashboard 构建（静默跳过复发）"
  echo "$OUT" | sed 's/^/    | /'
fi

echo "[2] 生产 sha == HEAD → 不触发（防误报）"
OUT=$(cd "$R" && CECELIA_DEPLOY_ROOT="$R" CECELIA_PROD_DASHBOARD_SHA="$C2" bash "$DEPLOY" --dry-run 2>&1) || true
if echo "$OUT" | grep -q "Dashboard 改动"; then
  fail "sha 一致仍触发（误报）"
  echo "$OUT" | sed 's/^/    | /'
else
  pass "sha 一致正确跳过"
fi

echo ""
echo "dashboard-sha-reconcile-smoke: PASS=$PASS FAIL=$FAIL"
[[ $FAIL -eq 0 ]]
```

- [ ] **Step 2: chmod + 跑一遍确认必红**

Run: `chmod +x scripts/smoke/dashboard-sha-reconcile-smoke.sh && bash scripts/smoke/dashboard-sha-reconcile-smoke.sh`
Expected: **FAIL**，场景 [1] 输出"未触发 Dashboard 构建"，fixture 日志含"跳过：没有 Brain、Dashboard 或 Workflow Skills 改动"。退出码非 0。

- [ ] **Step 3: commit-1（只加这一个文件）**

```bash
git add scripts/smoke/dashboard-sha-reconcile-smoke.sh
git commit -m "test(deploy): dashboard 判变 SHA 对账 failing smoke（Red）[1e5bc3e4]"
```

---

### Task 2: deploy-local.sh 判变对账（让 smoke 变绿）

**Files:**
- Modify: `scripts/deploy-local.sh`

- [ ] **Step 1: 把部署根守卫块挪到 SHA 对账之前（修现存时序 bug）**

现状顺序：CHANGED_FILES 检测（64-71 行）→ Brain SHA 对账（73-96 行）→ 打印改动范围（98-104 行）→ 守卫（106-139 行）→ NEED 判断。守卫 fetch 之前 origin/main 是旧引用，Brain 对账可能误判一致。

改后顺序：**守卫 → CHANGED_FILES 检测 → Brain SHA 对账 → Dashboard 对账（新）→ 打印 → NEED 判断**。

操作：把"── 部署根守卫 ──"整块（从 `# ── 部署根守卫（07-10 Gate3 五连红根治）──` 注释起到该块结尾的 `fi\n    echo ""` 止，即现 106-139 行）整体剪切，粘贴到 `echo "  主仓库: $MAIN_ROOT"` + 空行 echo（现 60-62 行）之后、`# 检测改动文件范围` 注释之前。逻辑一字不改，纯移动。

- [ ] **Step 2: Brain SHA 对账之后插入 Dashboard 对账段**

在 Brain SHA 对账块（`else\n    echo "⚠️  SHA 对账：无法获取完整 SHA…"\nfi`）之后、`echo "📋 改动范围："` 之前插入：

```bash
# ── Dashboard 判变：生产自报 SHA 对账（与 Brain SHA 对账同构，bug 89079934）──
# 专用部署根 reset --hard 后 git diff origin/main...HEAD 恒空，dashboard 改动会被
# 静默跳过（#4022/#4038 实证）。真相 = 生产容器在服产物自报的 build-info.json git_sha。
# 注意：build-info.json 不存在时 SPA fallback 返 200+HTML（非 404），-f 抓不住，
# 靠 JSON 解析失败兜底。测试钩子 CECELIA_PROD_DASHBOARD_SHA 注入（禁复用
# CECELIA_PROD_GIT_SHA——那是 Brain 的，会连带 NEED_BRAIN 在隔离根炸 brain-deploy.sh）。
DASHBOARD_SHA_MISMATCH=false
DASH_PROD_SHA="${CECELIA_PROD_DASHBOARD_SHA:-}"
if [[ -z "$DASH_PROD_SHA" && -z "${CECELIA_DEPLOY_ROOT:-}" ]]; then
    DASH_PROD_SHA=$(curl -sf --max-time 5 "http://localhost:5211/build-info.json" 2>/dev/null \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.git_sha||'')}catch{process.stdout.write('')}})" \
        2>/dev/null || echo "")
    [[ "$DASH_PROD_SHA" == "unknown" ]] && DASH_PROD_SHA=""
fi
if [[ -n "$DASH_PROD_SHA" ]]; then
    DASH_BASE_REF="origin/$BASE_BRANCH"
    git -C "$MAIN_ROOT" rev-parse --verify "$DASH_BASE_REF" >/dev/null 2>&1 || DASH_BASE_REF="$BASE_BRANCH"
    DASH_FULL_SHA=$(git -C "$MAIN_ROOT" rev-parse --verify "${DASH_PROD_SHA}^{commit}" 2>/dev/null || echo "")
    if [[ -z "$DASH_FULL_SHA" ]]; then
        echo "🔎 Dashboard 对账：生产自报 sha=${DASH_PROD_SHA} 不在 git 历史 → 保守触发构建"
        DASHBOARD_SHA_MISMATCH=true
    else
        DASH_DIFF=$(git -C "$MAIN_ROOT" diff --name-only "$DASH_FULL_SHA".."$DASH_BASE_REF" -- apps/dashboard apps/api 2>/dev/null || echo "")
        if [[ -n "$DASH_DIFF" ]]; then
            echo "🔎 Dashboard 对账：生产=${DASH_PROD_SHA} ← ${DASH_BASE_REF} 有 dashboard 改动 → 触发构建"
            DASHBOARD_SHA_MISMATCH=true
        else
            echo "✅ Dashboard 对账：生产=${DASH_PROD_SHA} 与 ${DASH_BASE_REF} 无 dashboard 改动"
        fi
    fi
elif [[ -z "${CECELIA_DEPLOY_ROOT:-}" ]]; then
    echo "⚠️  Dashboard 对账：拿不到生产自报 sha（容器未起/产物无 build-info.json）→ 保守触发构建"
    DASHBOARD_SHA_MISMATCH=true
else
    echo "⚠️  Dashboard 对账：测试模式未注入 CECELIA_PROD_DASHBOARD_SHA，跳过"
fi
```

- [ ] **Step 3: NEED 判断后叠加 mismatch + 去重闸**

现有 `[[ "$SHA_MISMATCH" == true ]] && NEED_BRAIN=true`（165 行附近）之后追加：

```bash
# Dashboard 对账结果叠加（webhook changed_paths 降级为并集提示，不再是唯一判据）
[[ "$DASHBOARD_SHA_MISMATCH" == true ]] && NEED_DASHBOARD=true

# ── 去重闸：staging 已就绪等放行时不重建（防刀2前保守构建 + Bark 风暴）──────
if [[ "$NEED_DASHBOARD" == true ]]; then
    DEDUP_PENDING="$MAIN_ROOT/apps/dashboard/.staging-pending"
    if [[ -f "$DEDUP_PENDING" ]]; then
        DEDUP_COMMIT=$(grep '^commit=' "$DEDUP_PENDING" | head -1 | cut -d= -f2)
        DEDUP_HEAD=$(git -C "$MAIN_ROOT" rev-parse --short "origin/$BASE_BRANCH" 2>/dev/null \
            || git -C "$MAIN_ROOT" rev-parse --short "$BASE_BRANCH" 2>/dev/null || echo "")
        if [[ -n "$DEDUP_COMMIT" && -n "$DEDUP_HEAD" && "$DEDUP_COMMIT" == "$DEDUP_HEAD" ]]; then
            echo "⏸️  staging 已就绪（commit $DEDUP_COMMIT）等人工放行 → 跳过重建（防重复构建/Bark）"
            NEED_DASHBOARD=false
        fi
    fi
fi
```

- [ ] **Step 4: 构建路径传 GIT_SHA（产物烙 sha 的输入端）**

docker 构建分支（`docker run --rm` 块）在 `-e NODE_OPTIONS=…` 后加一行：

```bash
                    -e GIT_SHA="$(git -C "$MAIN_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)" \
```

非 docker 分支把 `NODE_OPTIONS="--max-old-space-size=3072" npm run build -- --outDir "$STAGING_DIST"` 改为：

```bash
                GIT_SHA="$(git -C "$MAIN_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)" \
                    NODE_OPTIONS="--max-old-space-size=3072" npm run build -- --outDir "$STAGING_DIST"
```

- [ ] **Step 5: 语法冒烟 + 跑 smoke 确认绿**

Run: `bash -n scripts/deploy-local.sh && bash scripts/smoke/dashboard-sha-reconcile-smoke.sh`
Expected: PASS=2 FAIL=0，退出 0。

- [ ] **Step 6: 存量 gate-smoke 不被打红**

Run: `bash scripts/smoke/dashboard-staging-gate-smoke.sh`
Expected: 全 pass（该 smoke 设 CECELIA_DEPLOY_ROOT 且不设新钩子 → 对账跳过，行为不变）。

- [ ] **Step 7: commit-2**

```bash
git add scripts/deploy-local.sh
git commit -m "fix(deploy): dashboard 判变改生产自报 SHA 对账 + 守卫时序前移 + 去重闸（Green）[1e5bc3e4]"
```

---

### Task 3: vite 插件烙 build-info.json + selfcheck 生成守卫

**Files:**
- Modify: `apps/dashboard/vite.config.ts`
- Modify: `scripts/dashboard-staging-selfcheck.sh`
- Modify: `scripts/smoke/dashboard-staging-gate-smoke.sh`（make_fixture 补假 build-info）

- [ ] **Step 1: vite.config.ts 加内联插件**

顶部 import 区加：

```ts
import { execSync } from 'child_process'
import type { Plugin } from 'vite'
```

`export default defineConfig({` 之前加插件工厂：

```ts
// 产物自报身份：把构建时的 git sha 烙进 build-info.json（deploy-local.sh 判变对账用）。
// emitFile 自动跟随 --outDir（deploy-local 构建到 .dist-staging，写死 dist/ 不行）。
// docker 构建容器（node:20-alpine）无 git，GIT_SHA 由 deploy-local.sh 以 -e 传入。
function buildInfoPlugin(): Plugin {
  return {
    name: 'build-info',
    generateBundle() {
      let sha = process.env.GIT_SHA || ''
      if (!sha) {
        try {
          sha = execSync('git rev-parse HEAD', { cwd: __dirname }).toString().trim()
        } catch {
          sha = 'unknown'
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: JSON.stringify({ git_sha: sha, built_at: new Date().toISOString() }, null, 2),
      })
    },
  }
}
```

`plugins: [` 数组里 `react(),` 之后加 `buildInfoPlugin(),`。

- [ ] **Step 2: selfcheck 增加 build-info 存在性断言**

读 `scripts/dashboard-staging-selfcheck.sh`，在其现有检查序列的最后一项检查之后、成功 exit 之前，插入（变量名按该文件实际的 dist 目录参数名调整，其第一个位置参数即 staging dist 路径）：

```bash
# ── build-info.json 生成守卫（判变对账的数据源，缺失=对账退化为保守构建）──
BUILD_INFO="$DIST_DIR/build-info.json"
if [[ ! -f "$BUILD_INFO" ]]; then
    echo "❌ selfcheck: 产物缺 build-info.json（vite build-info 插件没生效？）"
    exit 1
fi
BI_SHA=$(node -e "let s=require('fs').readFileSync('$BUILD_INFO','utf8');try{process.stdout.write(JSON.parse(s).git_sha||'')}catch{process.stdout.write('')}" 2>/dev/null || echo "")
if [[ -z "$BI_SHA" ]]; then
    echo "❌ selfcheck: build-info.json 无 git_sha 字段"
    exit 1
fi
echo "✅ selfcheck: build-info.json git_sha=${BI_SHA:0:12}"
```

（若该文件的 dist 变量名不是 `DIST_DIR`，用它实际的变量名。）

- [ ] **Step 3: gate-smoke 的 make_fixture 补假 build-info.json**

`scripts/smoke/dashboard-staging-gate-smoke.sh` 的 `make_fixture()` 函数体内（写 index.html 的语句之后）加：

```bash
  printf '{"git_sha":"fixture-fake-sha","built_at":"1970-01-01T00:00:00Z"}' > "$1/build-info.json"
```

（`$1` 为 make_fixture 的目标目录参数；若函数用其他变量名，对应替换。）

- [ ] **Step 4: 跑 gate-smoke 验证 selfcheck 链路**

Run: `bash scripts/smoke/dashboard-staging-gate-smoke.sh && bash scripts/smoke/dashboard-sha-reconcile-smoke.sh`
Expected: 两个都全 pass（fixture 带假 build-info → selfcheck 新断言过）。

- [ ] **Step 5: commit**

```bash
git add apps/dashboard/vite.config.ts scripts/dashboard-staging-selfcheck.sh scripts/smoke/dashboard-staging-gate-smoke.sh
git commit -m "feat(deploy): vite 产物烙 build-info.json + selfcheck 生成守卫 [1e5bc3e4]"
```

---

### Task 4: promote fatal 化 + 指纹校验升级 sha 对账 + 存量测试接缝

**Files:**
- Modify: `scripts/promote-dashboard.sh`
- Modify: `scripts/check-deploy-fingerprint.sh`
- Modify: `packages/engine/tests/integration/release-deploy-stage.test.sh`

- [ ] **Step 1: check-deploy-fingerprint.sh 升级——优先 build-info sha 对账，退回 index hash**

在 `_hash()` 函数之后加：

```bash
# 取 build-info.json 的 git_sha；FETCH_FAIL=取不到，PARSE_FAIL=非 JSON（如 SPA fallback 的 HTML）
_get_sha() {
    local url="$1" body
    body=$(curl -s --max-time "$TIMEOUT" "$url/build-info.json" 2>/dev/null) || { echo "FETCH_FAIL"; return; }
    [[ -z "$body" ]] && { echo "FETCH_FAIL"; return; }
    printf '%s' "$body" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.git_sha||'PARSE_FAIL')}catch{process.stdout.write('PARSE_FAIL')}})" 2>/dev/null || echo "PARSE_FAIL"
}
```

主流程 `echo "=== 部署后指纹校验 ==="` 之后、现有 `LOCAL_HASH=$(_hash …)` 之前插入 sha 对账优先路径：

```bash
LOCAL_SHA=$(_get_sha "$LOCAL_URL")
if [[ "$LOCAL_SHA" != "FETCH_FAIL" && "$LOCAL_SHA" != "PARSE_FAIL" && -n "$LOCAL_SHA" ]]; then
    echo "  本机 5211 git_sha: $LOCAL_SHA"
    # 期望 sha（promote 从新产物 build-info.json 读出后经 env 传入）
    if [[ -n "${EXPECTED_GIT_SHA:-}" && "$LOCAL_SHA" != "$EXPECTED_GIT_SHA" ]]; then
        MSG="本机在服 sha=${LOCAL_SHA:0:12} ≠ 新产物 sha=${EXPECTED_GIT_SHA:0:12}——病因二选一：①分家（容器挂载目录≠部署根 dist）②inode 陈旧（mv 换目录后容器持旧 inode，重启 cecelia-frontend 后复查）"
        echo "❌ $MSG"
        _send_bark "Cecelia 部署对账 MISMATCH 🔴" "$MSG"
        exit 1
    fi
    if [[ -n "${CECELIA_SKIP_HK:-}" ]]; then
        echo "  CECELIA_SKIP_HK 已设，跳过 HK sha 对比"
        echo "✅ sha 对账：本机 PASS（${LOCAL_SHA:0:12}…）"
        exit 0
    fi
    HK_SHA=$(_get_sha "$HK_URL")
    if [[ "$HK_SHA" != "FETCH_FAIL" && "$HK_SHA" != "PARSE_FAIL" && -n "$HK_SHA" ]]; then
        echo "  HK    5211 git_sha: $HK_SHA"
        if [[ "$LOCAL_SHA" == "$HK_SHA" ]]; then
            echo "✅ sha 对账一致：本机 = HK（${LOCAL_SHA:0:12}…）"
            exit 0
        else
            MSG="dashboard sha 不一致！local=${LOCAL_SHA:0:12} HK=${HK_SHA:0:12}——HK 未同步"
            echo "❌ $MSG"
            _send_bark "Cecelia sha MISMATCH 🔴" "$MSG"
            exit 1
        fi
    fi
    echo "  ⚠️ HK build-info 取不到（${HK_SHA}），退回 index hash 对比"
fi
echo "  ⚠️ build-info sha 不可用（旧产物/服务异常），退回 index hash 对比"
```

现有 index hash 逻辑保持为回退路径，不删。

- [ ] **Step 2: promote-dashboard.sh fatal 化 + 清理段前移 + 头注释修正**

do_deploy 函数内，按顺序改四处：

① 把"停常驻 staging 服务 + 清放行标记"整块（`if [[ -n "${STAGED_PID:-}" ]]…` 到 `rm -f "$PENDING_FILE" …` 止）**剪切到 HK 同步段之前**（即 `# ── HK 同步：…` 注释之前），保证终验红时 staging 已收尾。

② HK rsync 段改 fatal（在函数开头附近声明 `local PROMOTE_FAIL=0`）：

```bash
    # ── HK 同步：rsync 本机 live dist → HK /opt/cecelia/frontend/dist/ ───────────
    if [[ -z "${CECELIA_SKIP_HK:-}" ]]; then
        echo "🌏 同步 HK（hk-vps）..."
        local HK_DEST="hk-vps:/opt/cecelia/frontend/dist/"
        if rsync -az --delete -e "ssh -o ConnectTimeout=10" "$DIST_DIR/" "$HK_DEST" 2>&1; then
            echo "✅ HK 已同步：$HK_DEST"
        else
            echo "❌ HK rsync 失败（本机 5211 已上线不回滚；Bark 由下方指纹校验兜底发）"
            PROMOTE_FAIL=1
        fi
    fi
```

③ 指纹校验段改 fatal + 传期望 sha：

```bash
    # ── 部署后终验：build-info sha 对账（优先）/ index hash（回退）────────────
    if [[ -z "${CECELIA_SKIP_FINGERPRINT:-}" ]]; then
        local FP_SCRIPT="$MAIN_ROOT/scripts/check-deploy-fingerprint.sh"
        if [[ -f "$FP_SCRIPT" ]]; then
            local EXPECTED_SHA=""
            if [[ -f "$DIST_DIR/build-info.json" ]]; then
                EXPECTED_SHA=$(node -e "let s=require('fs').readFileSync('$DIST_DIR/build-info.json','utf8');try{process.stdout.write(JSON.parse(s).git_sha||'')}catch{process.stdout.write('')}" 2>/dev/null || echo "")
            fi
            if ! EXPECTED_GIT_SHA="$EXPECTED_SHA" bash "$FP_SCRIPT"; then
                echo "❌ 部署终验失败（见上方报告）"
                PROMOTE_FAIL=1
            fi
        fi
    fi
```

④ 函数末尾成功 echo 改为按 PROMOTE_FAIL 分流：

```bash
    if [[ "$PROMOTE_FAIL" == "1" ]]; then
        echo "🔴 deploy 结束：本机 5211 已上线 ${tag}，但 HK 同步/终验对账红（见上方）——退出非零"
        exit 1
    fi
    echo "🎉 deploy 完成：本机 5211 已上线 ${tag}，HK 已同步，staging 已停、标记已清。"
```

⑤ 头注释（第 13 行附近）`# Cecelia 单实例内部工具，只更新本机 5211，不同步 HK/Tailscale。` 改为：

```bash
# deploy 模式会同步 HK（hk-vps:/opt/cecelia/frontend/dist）并做部署终验（sha 对账）。
# HK 失败/终验红：本机不回滚（已原子换入），退出非零 = "本机已上线但对账红"。
```

- [ ] **Step 3: release-deploy-stage.test.sh 接缝（防 CI 假红）**

`run()` 函数（29-32 行）加两个 skip（CI ubuntu 无 hk-vps 可达、无 5211 服务，fatal 化后必红）：

```bash
run() {  # <root> args...
    local R="$1"; shift
    CECELIA_DEPLOY_ROOT="$R" CECELIA_SKIP_BRAIN_PROMOTE=1 CECELIA_SKIP_HK=1 CECELIA_SKIP_FINGERPRINT=1 \
        bash "$PROMOTE" "$@" >/dev/null 2>&1
}
```

gate-smoke 场景 [B]（144 行 `bash "$PROMOTE"` 那条）在其 env 前缀里补 `CECELIA_SKIP_FINGERPRINT=1`（它已带 CECELIA_SKIP_HK=1；FP 本机 curl 5211 在 CI 上必 FETCH_FAIL）。

- [ ] **Step 4: 全量验证**

Run:
```bash
bash -n scripts/promote-dashboard.sh && bash -n scripts/check-deploy-fingerprint.sh
bash packages/engine/tests/integration/release-deploy-stage.test.sh
bash scripts/smoke/dashboard-staging-gate-smoke.sh
bash scripts/smoke/dashboard-sha-reconcile-smoke.sh
```
Expected: 语法 OK；三个测试全 pass。

- [ ] **Step 5: commit**

```bash
git add scripts/promote-dashboard.sh scripts/check-deploy-fingerprint.sh packages/engine/tests/integration/release-deploy-stage.test.sh scripts/smoke/dashboard-staging-gate-smoke.sh
git commit -m "fix(deploy): promote HK 同步/终验 fatal 化 + 指纹校验升级 build-info sha 对账 [1e5bc3e4]"
```

---

### Task 5: DevGate + 收尾自检

- [ ] **Step 1: DevGate（改的是 scripts/，Brain src 未动，预期全过）**

Run:
```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
```
Expected: 全过（未动 packages/brain/src；若 check-version-sync 因 packages/engine/tests 变更要求 engine bump，按 `docs/` 下 version-management 惯例 bump engine 5 文件后重跑）。

- [ ] **Step 2: 信息卫生自查**

确认无 console.log 残留、无注释掉的代码、无临时文件；`git status` 干净（除已 commit 内容）。

- [ ] **Step 3: 最终全绿复跑**

Run: `bash scripts/smoke/dashboard-sha-reconcile-smoke.sh && bash scripts/smoke/dashboard-staging-gate-smoke.sh && bash packages/engine/tests/integration/release-deploy-stage.test.sh && echo ALL_GREEN`
Expected: `ALL_GREEN`

---

## Self-Review 结论

- Spec 覆盖：组件 1→Task 3；组件 2→Task 2；组件 3→Task 4；组件 4→Task 3 Step 3 + Task 4 Step 3；integration 测试→Task 1。E2E proven-to-fire 按 spec 属 merge 后人工步骤，不在本 plan（engine-ship 后执行）。
- 无占位符；变量名跨 Task 一致（DASHBOARD_SHA_MISMATCH / CECELIA_PROD_DASHBOARD_SHA / EXPECTED_GIT_SHA / PROMOTE_FAIL / build-info.json）。
- 每 Task 独立可验证；TDD 顺序 commit-1 Red → commit-2 Green 落在 Task 1/2。
