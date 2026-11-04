#!/usr/bin/env bash
# runtime(--omit=dev) high+门：仅允许已审核的“包名+具体GHSA”，不自动豁免同包新公告。
# critical仍由dep-audit-critical.sh全量逐公告检查；audit工具/证据异常一律拒绝。
set -uo pipefail

# 仅收窄原包级豁免，不增加包或风险情形；条件变化时应修依赖并移除对应项。
ALLOW_ADVISORIES=(
  # 原uuid buf边界公告：现有调用仅v4，无v3/v5/v6的buf输入；升级安全版本后移除。
  "uuid|GHSA-w5hq-g745-h8pq"
  # 原OTel JaegerPropagator DoS：src/otel.js配置OTLP，不注册JaegerPropagator。
  # 当前npm回执标题对应此既有风险；OTel依赖链升级后移除。
  "@opentelemetry/propagator-jaeger|GHSA-45rx-2jwx-cxfr"
  # 原react-router RSC action公告：现有客户端Router不启用RSC/server action。
  "react-router|GHSA-qwww-vcr4-c8h2"
  # 原braces嵌套模式DoS：代理路由只用固定路径，不接收用户glob模式。
  "braces|GHSA-vfj7-8cjw-p6xm"
)
# 旧protobufjs/dompurify包级条目没有明确公告ID，不再授予全包豁免。
# 未知公告保持红灯；后续不得从实时audit结果自动扩充此表。

JSON=$(npm audit --audit-level=high --omit=dev --json 2>/dev/null)
AUDIT_EXIT=$?
if [ "$AUDIT_EXIT" -gt 1 ]; then
  echo "依赖审计工具异常退出：$AUDIT_EXIT" >&2
  exit 1
fi
printf '%s' "$JSON" | NPM_AUDIT_STATUS="$AUDIT_EXIT" node "$(dirname "${BASH_SOURCE[0]}")/validate-npm-audit.mjs" || exit 1

UNWAIVED=$(echo "$JSON" | ALLOW="${ALLOW_ADVISORIES[*]:-}" python3 -c "
import sys, json, os, re
from urllib.parse import urlsplit
allow = {tuple(value.split('|', 1)) for value in os.environ.get('ALLOW','').split()}
d = json.load(sys.stdin)
bad = {}
for name, v in d.get('vulnerabilities', {}).items():
    # 只信这个包自己直接挂着的 advisory（via 里的 dict 项，带它自己的 severity/cvss）。
    # 不用顶层 v['severity']——那是 npm 沿整条依赖链滚算出来的聚合值，会被链上别的
    # 包的高危漏洞拉高，哪怕这个包跟那条 CVE 的关系只是'依赖了持有它的包'，不是
    # '自己有洞'。真正持有该 CVE 的包会在同一份 audit 输出里单独有自己的顶层条目
    # （自己的 via 里就有这条 advisory），用它自己的条目判断即可，不需要在这里对
    # 每一层继承者重复拦一次，否则会出现包没有任何自己的 CVE 却被拦下的假阳性。
    advisories = [via for via in v.get('via', []) if isinstance(via, dict)]
    if not advisories:
        continue  # 纯继承（via 全是包名字符串），没有自己的 advisory，交给真正持有 CVE 的那个包条目处理
    own_high = []
    for advisory in advisories:
        if advisory.get('severity') not in ('high', 'critical'):
            continue
        url = urlsplit(advisory['url'])
        ghsa = url.path.rsplit('/', 1)[-1]
        canonical = (url.scheme == 'https' and url.netloc == 'github.com'
                     and url.path == '/advisories/' + ghsa and not url.query and not url.fragment
                     and re.fullmatch(r'GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}', ghsa))
        if canonical and (name, ghsa) in allow:
            continue
        own_high.append(advisory)
    if not own_high:
        continue
    titles = [a.get('title','') for a in own_high]
    bad[name] = (own_high[0].get('severity'), '; '.join(t for t in titles if t)[:70])
for n, (sev, t) in sorted(bad.items()):
    print(f'{n}\t{sev}\t{t}')
") || exit 1

if [ -n "$UNWAIVED" ]; then
  echo "::error::dep-audit-runtime-high 发现未豁免的 runtime high+ 漏洞："
  echo "$UNWAIVED" | while IFS=$'\t' read -r pkg sev title; do echo "  ❌ $pkg [$sev] — $title"; done
  echo "  处理：npm audit fix 升级；确属无 non-breaking 修复+不可利用才按包名与GHSA精确登记（须有原风险依据，禁止全包通行）"
  exit 1
fi
echo "✅ dep-audit-runtime-high 通过（精确公告豁免 ${#ALLOW_ADVISORIES[@]} 条已文档化）"
exit 0
