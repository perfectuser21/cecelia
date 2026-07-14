package com.zenithjoy.agent.capture

/**
 * 纯 Kotlin 工具层——无 Android 框架依赖，可在 JVM 单元测试中直接覆盖。
 *
 * 核心修复点：findFirstOnScreenNodeByDescPrefix 在 BFS 时加屏幕内可见性守卫，
 * 过滤掉竖向翻页器中负 y 坐标（屏幕外）的相邻视频分享按钮，只返回当前可见节点。
 */

data class ScreenBounds(val width: Int, val height: Int)

data class NodeRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val centerX: Float get() = (left + right) / 2f
    val centerY: Float get() = (top + bottom) / 2f
}

/** 节点是否完全在屏幕可视区域内（宽高 > 0，四边均在屏幕内）。 */
fun isOnScreen(rect: NodeRect, screen: ScreenBounds): Boolean =
    rect.left >= 0 && rect.top >= 0 &&
        rect.right <= screen.width && rect.bottom <= screen.height &&
        rect.right > rect.left && rect.bottom > rect.top

/** 可注入的节点抽象，方便 JVM 单测中用 fake 替代 AccessibilityNodeInfo。 */
interface CaptureNode {
    val contentDesc: String?
    val bounds: NodeRect
    val childCount: Int
    fun getChild(i: Int): CaptureNode?
}

/**
 * BFS 遍历无障碍树，返回第一个满足以下条件的节点：
 *   1. contentDesc 以 [prefix] 开头
 *   2. bounds 完全在 [screen] 可视区域内（屏幕内可见性守卫）
 *
 * 竖向翻页器中屏幕外（负 y）的邻帧分享按钮会被过滤，不会误触发。
 */
fun findFirstOnScreenNodeByDescPrefix(
    root: CaptureNode,
    prefix: String,
    screen: ScreenBounds,
): CaptureNode? {
    val queue = ArrayDeque<CaptureNode>()
    queue.add(root)
    while (queue.isNotEmpty()) {
        val node = queue.removeFirst()
        val desc = node.contentDesc ?: ""
        if (desc.startsWith(prefix) && isOnScreen(node.bounds, screen)) {
            return node
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { queue.add(it) }
        }
    }
    return null
}
