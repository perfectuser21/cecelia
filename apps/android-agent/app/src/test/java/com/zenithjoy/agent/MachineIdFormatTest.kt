package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

/**
 * 机器指纹算法单元测试（不依赖 Android SDK，纯 JVM）
 *
 * 验证：Android ID + 型号 → SHA256 前32位十六进制，长度 32，跨同等输入确定性
 */
class MachineIdFormatTest {

    private fun computeFingerprint(androidId: String, model: String): String {
        val raw = "$androidId|$model"
        return MessageDigest.getInstance("SHA-256")
            .digest(raw.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
            .take(32)
    }

    @Test
    fun `fingerprint length is 32 hex chars`() {
        val id = computeFingerprint("abc123", "Pixel 8")
        assertEquals(32, id.length)
    }

    @Test
    fun `fingerprint is deterministic for same input`() {
        val a = computeFingerprint("abc123", "Pixel 8")
        val b = computeFingerprint("abc123", "Pixel 8")
        assertEquals(a, b)
    }

    @Test
    fun `fingerprint differs for different android ids`() {
        val a = computeFingerprint("device001", "Pixel 8")
        val b = computeFingerprint("device002", "Pixel 8")
        assertTrue("same-model different IDs must differ", a != b)
    }

    @Test
    fun `fingerprint differs for different models`() {
        val a = computeFingerprint("same-id", "Pixel 8")
        val b = computeFingerprint("same-id", "Samsung S24")
        assertTrue("same-id different models must differ", a != b)
    }

    @Test
    fun `fingerprint contains only lowercase hex chars`() {
        val id = computeFingerprint("testid", "TestModel")
        assertTrue("must be lowercase hex", id.matches(Regex("[0-9a-f]+")))
    }
}
