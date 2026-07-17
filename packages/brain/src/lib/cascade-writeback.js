/**
 * S3 联动清单格子状态回写
 * evaluator PASS 后，把 cascade_assertions 中跑过且 pass 的项回写 cell_status='green'
 * 所有失败均为非致命，不阻塞主流程
 */

export async function writeCascadeCellStatuses(cascadeAssertions) {
  if (!Array.isArray(cascadeAssertions) || cascadeAssertions.length === 0) {
    return { written: 0, skipped: 0 };
  }
  let written = 0;
  let skipped = 0;
  for (const item of cascadeAssertions) {
    if (!item.link_id || !item.ran || item.result !== 'pass') {
      skipped++;
      continue;
    }
    try {
      const resp = await fetch(
        `http://localhost:5221/api/brain/journey_step_links/${item.link_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cell_status: 'green' }),
        }
      );
      if (resp.ok) {
        written++;
      } else {
        console.warn(`[cascade-writeback] PATCH link ${item.link_id} failed ${resp.status} (non-fatal)`);
        skipped++;
      }
    } catch (e) {
      console.warn(`[cascade-writeback] PATCH link ${item.link_id} error (non-fatal): ${e.message}`);
      skipped++;
    }
  }
  return { written, skipped };
}
