// postcondition.mjs —— 「这件事到底成没成」的判定分派
//
// 铁律是「判定层不蒸馏」：不许把语义判断硬编码成一串脆弱规则。
// 但那条铁律管的是**语义推断**，不管**系统状态读取**。
//
// 「进没进抖音发布页」这个问题，安卓自己就有确定性答案：前台 activity 是不是
// VideoRecordNewActivity。拿它去问 LLM 看截图，既费 token 又多一层会看错的东西；
// 而且权限弹窗遮挡时前台会变成弹窗，activity 探针反而顺手把这种情况也抓住了。
//
// 所以分派原则：系统能确定性回答的走 activity，只有真需要语义判断的才落到视觉。

export function activityMatches(currentFocus, expected) {
  if (!currentFocus || !expected) return false;
  return currentFocus.includes(expected);
}

/**
 * @param post  序列里的 postcondition 声明
 * @param ctx   运行上下文（target 等占位符来源）
 * @param deps  { currentFocus(): string, vision(desc, ctx): Promise<{ok, why}> }
 */
export async function evaluatePostcondition(post, ctx = {}, deps = {}) {
  if (post?.type === 'foreground_activity') {
    const cur = deps.currentFocus?.() ?? '';
    const ok = activityMatches(cur, post.value);
    return {
      ok,
      why: ok ? `前台=${cur}` : `前台=${cur || 'unknown'}，期望含 ${post.value}`,
    };
  }

  // 视觉判定：保持原有行为不动
  const desc = (post?.describe ?? '').replaceAll('{target}', ctx.target ?? '');
  return deps.vision(desc, ctx);
}
