package com.zenithjoy.agent.capture

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Stage1 无障碍服务：从抖音视频详情页点击分享按钮、提取复制链接。
 *
 * 修复要点（对齐 PRD 根因描述）：
 *   - findNodeByContentDescPrefix → 调用 findFirstOnScreenNodeByDescPrefix，
 *     只选取屏幕内可见节点，过滤竖向翻页器中负 y 坐标的屏外邻帧分享按钮。
 *   - tapNodeCenter → 先校验 bounds 在屏幕内，再 dispatchGesture；
 *     负坐标/屏外坐标直接返回 false，不派发手势。
 */
class CaptureAccessibilityService : AccessibilityService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // ── 单例入口：HeartbeatLoop 派发任务后写入，服务侧轮询 ────────────────────
    companion object {
        @Volatile
        var instance: CaptureAccessibilityService? = null

        /** 外部（AgentService / HeartbeatLoop）调用以触发 Stage1 捕获。 */
        suspend fun requestCapture(
            shareButtonDesc: String = "分享",
            copyLinkDesc: String = "复制链接",
            onResult: (link: String?) -> Unit,
        ) {
            val svc = instance ?: run { onResult(null); return }
            svc.executeStage1(shareButtonDesc, copyLinkDesc, onResult)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // ── Stage1 主流程 ────────────────────────────────────────────────────────

    private suspend fun executeStage1(
        shareButtonDesc: String,
        copyLinkDesc: String,
        onResult: (link: String?) -> Unit,
    ) {
        val screen = currentScreenBounds()

        // 1. 找分享按钮（屏幕内可见性守卫）
        val shareNode = findNodeByContentDescPrefix(shareButtonDesc, screen)
        if (shareNode == null) {
            onResult(null)
            return
        }

        // 2. 点击分享按钮（坐标在屏幕内才派发手势）
        val tapped = tapNodeCenter(shareNode, screen)
        if (!tapped) {
            onResult(null)
            return
        }

        // 3. 等待分享面板弹出（最多 2 秒）
        val copyNode = waitForNode(copyLinkDesc, screen, timeoutMs = 2000)
        if (copyNode == null) {
            onResult(null)
            return
        }

        // 4. 点击"复制链接"
        tapNodeCenter(copyNode, screen)

        // 5. 读剪贴板（需在主线程）
        delay(300)
        val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
        val link = cm.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
        onResult(link)
    }

    // ── 内部辅助 ─────────────────────────────────────────────────────────────

    private fun currentScreenBounds(): ScreenBounds {
        val m = resources.displayMetrics
        return ScreenBounds(m.widthPixels, m.heightPixels)
    }

    /** 将 AccessibilityNodeInfo 适配为 CaptureNode 接口。 */
    private fun AccessibilityNodeInfo.asCaptureNode(): CaptureNode {
        val self = this
        return object : CaptureNode {
            override val contentDesc: String? get() = self.contentDescription?.toString()
            override val bounds: NodeRect get() {
                val r = Rect()
                self.getBoundsInScreen(r)
                return NodeRect(r.left, r.top, r.right, r.bottom)
            }
            override val childCount: Int get() = self.childCount
            override fun getChild(i: Int): CaptureNode? = self.getChild(i)?.asCaptureNode()
        }
    }

    /**
     * BFS 查找第一个 contentDesc 前缀匹配且屏幕内可见的节点。
     * 直接委托 CaptureNodeHelper，保证单测覆盖同一逻辑。
     */
    private fun findNodeByContentDescPrefix(prefix: String, screen: ScreenBounds): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val captureNode = findFirstOnScreenNodeByDescPrefix(root.asCaptureNode(), prefix, screen)
            ?: return null
        // 从原始树中重新查找，以获取真正的 AccessibilityNodeInfo（用于手势）
        return findAccessibilityNodeByDescPrefix(root, prefix, screen)
    }

    private fun findAccessibilityNodeByDescPrefix(
        node: AccessibilityNodeInfo,
        prefix: String,
        screen: ScreenBounds,
    ): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(node)
        while (queue.isNotEmpty()) {
            val n = queue.removeFirst()
            val desc = n.contentDescription?.toString() ?: ""
            if (desc.startsWith(prefix)) {
                val r = Rect()
                n.getBoundsInScreen(r)
                if (isOnScreen(NodeRect(r.left, r.top, r.right, r.bottom), screen)) return n
            }
            for (i in 0 until n.childCount) {
                n.getChild(i)?.let { queue.add(it) }
            }
        }
        return null
    }

    /**
     * 在屏幕内中心坐标处派发单点 tap 手势。
     * bounds 不在屏幕内时直接返回 false，不派发 dispatchGesture。
     */
    private fun tapNodeCenter(node: AccessibilityNodeInfo, screen: ScreenBounds): Boolean {
        val r = Rect()
        node.getBoundsInScreen(r)
        val rect = NodeRect(r.left, r.top, r.right, r.bottom)
        if (!isOnScreen(rect, screen)) return false

        val path = Path().apply { moveTo(rect.centerX, rect.centerY) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private suspend fun waitForNode(
        descPrefix: String,
        screen: ScreenBounds,
        timeoutMs: Long,
    ): AccessibilityNodeInfo? {
        val step = 100L
        var elapsed = 0L
        while (elapsed < timeoutMs) {
            val node = findNodeByContentDescPrefix(descPrefix, screen)
            if (node != null) return node
            delay(step)
            elapsed += step
        }
        return null
    }
}
