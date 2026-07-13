// packages/brain/src/dispatch-dedup.js
/**
 * 标题级重复判定——纯函数，无 IO。
 *
 * 背景：Brain 派发/orphan-worker 都需要判断"这件事是不是已经在办/办过了"，
 * 但两个独立 task_id（dispatcher 场景）或两个独立 PR（orphan-worker 场景）
 * 之间没有共享 ID，唯一可比对的信号是标题语义重叠。用 Jaccard（分词集合交并比）
 * 而非编辑距离——标题常见"在前一版基础上加一段后缀"（如 "...+ pm2 ecosystem"），
 * Jaccard 对这种子集扩展关系比编辑距离更稳健。
 */

/**
 * 分词：按空白/常见标点切分，转小写，过滤空 token。
 * 不做真正的中文分词（无依赖）——中英混合标题里的中文短语本身常以空格/标点
 * 与其他部分分隔（如 "常驻 daemon + running 超时回收"），按空白切分已能捕获有效 token。
 */
function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[\s+():{}[\]/\\,，。、\-—－]+/)
    .filter(Boolean);
}

/**
 * Jaccard 相似度：|交集| / |并集|，范围 [0,1]。
 * 两个空 token 集合返回 0（避免 0/0 = NaN；此时 union 必非空所以下面除法本身不会 0/0，
 * 这层提前 return 单纯是为了不把"双方都无有效 token"的退化情形误判成相似度 0/0=NaN）。
 */
export function titleSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const unionSize = setA.size + setB.size - intersection;
  return intersection / unionSize;
}

/**
 * 在候选列表里找第一个标题相似度 >= threshold 的，返回该候选本身；无命中返回 null。
 *
 * threshold 默认 0.6：用真实撞车案例校准（PR #3646"skill-eval-worker 常驻 daemon +
 * running 超时回收" vs #3647 同标题追加" + pm2 ecosystem"，Jaccard ≈0.78，远高于阈值；
 * 无关标题在 titleSimilarity 测试里 <0.3），留出安全边际防止合法的相邻小改动被误判为重复。
 *
 * @param {string} title 待判重的标题
 * @param {Array<object>} candidates 候选列表
 * @param {{threshold?: number, keyFn: (c:object)=>string}} opts keyFn 必填：从候选对象取标题
 */
export function findDuplicateSibling(title, candidates, opts) {
  const threshold = opts?.threshold ?? 0.6;
  const keyFn = opts?.keyFn;
  if (typeof keyFn !== 'function') {
    throw new Error('findDuplicateSibling: opts.keyFn is required and must be a function');
  }
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  for (const c of candidates) {
    if (titleSimilarity(title, keyFn(c)) >= threshold) return c;
  }
  return null;
}
