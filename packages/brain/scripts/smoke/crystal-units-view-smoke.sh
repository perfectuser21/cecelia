#!/usr/bin/env bash
# Smoke: crystal-units-view — 判官全景视图（按段取最新有效判决 + 时效标记）
# 验证：
#   1. buildUnitsView 已导出，SQL 用 DISTINCT ON 取每段最新，未退回单日等值筛
#   2. 当日无证据的已判决段仍出现在视图里（本缺口的守卫）
#   3. stale 阈值取 CRYSTAL_THRESHOLDS.demoteWindowDays，不写死
#   4. routes/crystal.js 挂了 GET /units
#   5.（live，Brain 可达时）真调端点，校验返回结构与 summary 自洽；
#      Brain 不可达或未部署本版本则跳过，不误报失败
set -euo pipefail
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[units-smoke] 1. 按段取最新，未退回单日筛"
node -e "
const fs=require('fs');
const src=fs.readFileSync('packages/brain/src/crystal-judge.js','utf8');
if(!src.includes('export async function buildUnitsView')){console.error('buildUnitsView 未导出');process.exit(1);}
if(!src.includes('DISTINCT ON (v.grid_key)')){console.error('未用 DISTINCT ON 取每段最新判决');process.exit(1);}
if(!src.includes('windowDays = CRYSTAL_THRESHOLDS.demoteWindowDays')){console.error('stale 阈值未取配置');process.exit(1);}
console.log('  ✓ DISTINCT ON + 阈值取配置');
"

echo "[units-smoke] 2-3. 行为：旧判决不消失、stale 按窗口算"
node --input-type=module -e "
const { buildUnitsView } = await import('./packages/brain/src/crystal-judge.js');
const { CRYSTAL_THRESHOLDS } = await import('./packages/brain/src/crystal/verdict-engine.js');
const poolOf=(rows)=>({query:async(sql)=>/FROM crystal_verdict/i.test(sql)?{rows,rowCount:rows.length}:{rows:[],rowCount:0}});
const NOW=new Date('2026-09-07T12:00:00Z');
const old={grid_key:'legacy_unit',funnel_cell:'source',report_date:'2026-09-06',verdict:'promote',basis:{},n_runs:20,success_rate:'1',token_cost:'10158',latency_ms:'25000',broken_count:0,data_gap:false};
const v=await buildUnitsView(poolOf([old]),NOW);
if(!v.units.some(u=>u.unit_key==='legacy_unit')){console.error('昨天判的段从视图消失了');process.exit(1);}
if(v.units[0].verdict_age_days!==1){console.error('age 计算错: '+v.units[0].verdict_age_days);process.exit(1);}
if(v.units[0].stale!==false){console.error('1 天不该判 stale');process.exit(1);}
const st=await buildUnitsView(poolOf([{...old,report_date:'2026-08-01'}]),NOW);
if(st.units[0].stale!==true){console.error('超窗口未判 stale');process.exit(1);}
if(!(st.units[0].verdict_age_days>CRYSTAL_THRESHOLDS.demoteWindowDays)){console.error('age 未超窗口');process.exit(1);}
if(v.summary.promote!==1||v.summary.total!==1){console.error('summary 不自洽');process.exit(1);}
console.log('  ✓ 旧判决保留 + age/stale 正确 + summary 自洽');
"

echo "[units-smoke] 4. GET /units 已挂"
node -e "
const fs=require('fs');
const src=fs.readFileSync('packages/brain/src/routes/crystal.js','utf8');
if(!src.includes(\"router.get('/units'\")){console.error('缺 GET /units 端点');process.exit(1);}
if(!src.includes('buildUnitsView(pool)')){console.error('端点未调 buildUnitsView');process.exit(1);}
console.log('  ✓ 端点已挂');
"

echo "[units-smoke] 5. live：真调端点校验结构"
if curl -sf --max-time 5 "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  RESP=$(curl -s --max-time 20 "$BRAIN_URL/api/brain/crystal/units")
  if echo "$RESP" | grep -q "Cannot GET"; then
    echo "    ⏭️  Brain 在线但未部署本版本，跳过 live 段"
    echo "[units-smoke] ✅ 静态检查全部通过（live 待部署后生效）"
    exit 0
  fi
  echo "$RESP" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  let j;try{j=JSON.parse(s)}catch{console.error('    响应非 JSON: '+s.slice(0,120));process.exit(1)}
  if(!j.as_of||!j.summary||!Array.isArray(j.units)){console.error('    结构缺字段');process.exit(1)}
  const sum=j.summary.promote+j.summary.keep_llm+j.summary.demote;
  if(sum!==j.summary.total){console.error('    summary 计数不自洽: '+sum+' vs '+j.summary.total);process.exit(1)}
  console.log('    ✓ as_of='+j.as_of+' 段数='+j.units.length+' promote='+j.summary.promote+' stale='+j.summary.stale);
});
"
else
  echo "    ⏭️  Brain 不可达，跳过 live 段"
fi
echo "[units-smoke] ✅ 全部通过"
