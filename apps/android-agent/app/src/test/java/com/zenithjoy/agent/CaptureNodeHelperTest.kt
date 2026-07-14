package com.zenithjoy.agent

import com.zenithjoy.agent.capture.CaptureNode
import com.zenithjoy.agent.capture.NodeRect
import com.zenithjoy.agent.capture.ScreenBounds
import com.zenithjoy.agent.capture.findFirstOnScreenNodeByDescPrefix
import com.zenithjoy.agent.capture.isOnScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * 回归测试：BFS 分享按钮选择 + 屏幕内可见性守卫。
 *
 * 复现 PRD 根因：抖音竖向翻页器中屏幕外（负 y）相邻视频的分享按钮
 * 在旧实现中被 BFS 首先返回，导致 tapNodeCenter 对负坐标调 dispatchGesture
 * 静默失败 → 分享面板不弹 → panel-miss → 取链失败。
 */
class CaptureNodeHelperTest {

    private val screen = ScreenBounds(width = 1080, height = 2400)

    // ── isOnScreen 边界测试 ─────────────────────────────────────────────────

    @Test
    fun `isOnScreen returns true for fully visible rect`() {
        assertTrue(isOnScreen(NodeRect(10, 100, 200, 300), screen))
    }

    @Test
    fun `isOnScreen returns false for rect with negative y (off-screen above)`() {
        // 这是 PRD 描述的根因场景：上方视频的分享按钮 top=-500
        assertFalse(isOnScreen(NodeRect(400, -500, 680, -300), screen))
    }

    @Test
    fun `isOnScreen returns false for rect with negative x`() {
        assertFalse(isOnScreen(NodeRect(-100, 200, 80, 400), screen))
    }

    @Test
    fun `isOnScreen returns false for rect extending beyond screen bottom`() {
        assertFalse(isOnScreen(NodeRect(0, 2300, 200, 2500), screen))
    }

    @Test
    fun `isOnScreen returns false for rect extending beyond screen right`() {
        assertFalse(isOnScreen(NodeRect(1000, 100, 1200, 300), screen))
    }

    @Test
    fun `isOnScreen returns false for zero-size rect`() {
        assertFalse(isOnScreen(NodeRect(100, 100, 100, 100), screen))
    }

    @Test
    fun `isOnScreen returns true for rect touching screen edges exactly`() {
        assertTrue(isOnScreen(NodeRect(0, 0, 1080, 2400), screen))
    }

    // ── BFS 可见性守卫测试 ──────────────────────────────────────────────────

    @Test
    fun `findFirstOnScreenNodeByDescPrefix skips off-screen share node and returns on-screen one`() {
        // 模拟抖音竖向翻页器：树中先出现的节点是屏幕外上方视频的分享按钮（y=-300）
        // 后出现的节点才是当前可见视频的分享按钮（y=1800）
        val offScreen = fakeNode(desc = "分享", rect = NodeRect(400, -300, 680, -100))
        val onScreen = fakeNode(desc = "分享", rect = NodeRect(400, 1800, 680, 2000))
        val root = fakeNode(children = listOf(offScreen, onScreen))

        val result = findFirstOnScreenNodeByDescPrefix(root, "分享", screen)

        assertNotNull(result)
        assertEquals(NodeRect(400, 1800, 680, 2000), result!!.bounds)
    }

    @Test
    fun `findFirstOnScreenNodeByDescPrefix returns null when no on-screen match`() {
        val offScreen = fakeNode(desc = "分享", rect = NodeRect(400, -300, 680, -100))
        val root = fakeNode(children = listOf(offScreen))

        val result = findFirstOnScreenNodeByDescPrefix(root, "分享", screen)

        assertNull(result)
    }

    @Test
    fun `findFirstOnScreenNodeByDescPrefix returns null when no prefix match`() {
        val node = fakeNode(desc = "其他按钮", rect = NodeRect(10, 100, 200, 300))
        val root = fakeNode(children = listOf(node))

        assertNull(findFirstOnScreenNodeByDescPrefix(root, "分享", screen))
    }

    @Test
    fun `findFirstOnScreenNodeByDescPrefix matches prefix not full desc`() {
        val node = fakeNode(desc = "分享给朋友", rect = NodeRect(10, 100, 200, 300))
        val root = fakeNode(children = listOf(node))

        assertNotNull(findFirstOnScreenNodeByDescPrefix(root, "分享", screen))
    }

    @Test
    fun `findFirstOnScreenNodeByDescPrefix does BFS not DFS`() {
        // BFS 应先找到深度 1 的节点，而不是深度 2 的节点
        val deeper = fakeNode(desc = "分享", rect = NodeRect(10, 100, 200, 300))
        val shallow = fakeNode(desc = "分享", rect = NodeRect(50, 500, 200, 700),
            children = listOf(deeper))
        val root = fakeNode(children = listOf(shallow))

        val result = findFirstOnScreenNodeByDescPrefix(root, "分享", screen)
        assertEquals(NodeRect(50, 500, 200, 700), result!!.bounds)
    }

    @Test
    fun `findFirstOnScreenNodeByDescPrefix handles empty tree`() {
        val root = fakeNode()
        assertNull(findFirstOnScreenNodeByDescPrefix(root, "分享", screen))
    }

    // ── NodeRect helpers ────────────────────────────────────────────────────

    @Test
    fun `NodeRect centerX and centerY are computed correctly`() {
        val r = NodeRect(100, 200, 300, 600)
        assertEquals(200f, r.centerX)
        assertEquals(400f, r.centerY)
    }

    // ── Test doubles ────────────────────────────────────────────────────────

    private fun fakeNode(
        desc: String? = null,
        rect: NodeRect = NodeRect(0, 0, 0, 0),
        children: List<CaptureNode> = emptyList(),
    ): CaptureNode = object : CaptureNode {
        override val contentDesc: String? = desc
        override val bounds: NodeRect = rect
        override val childCount: Int = children.size
        override fun getChild(i: Int): CaptureNode? = children.getOrNull(i)
    }
}
