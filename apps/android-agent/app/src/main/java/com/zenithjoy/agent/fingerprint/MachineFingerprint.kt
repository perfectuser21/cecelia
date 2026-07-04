package com.zenithjoy.agent.fingerprint

import android.content.Context
import android.os.Build
import android.provider.Settings
import java.security.MessageDigest

/**
 * 安卓机器指纹：Android ID + 设备型号 → SHA-256（前32位十六进制）
 *
 * 设计：与 Windows 端 computeMachineId() 保持相同格式（32位 hex），
 * 保证服务端 license_machines 表 machine_id 字段可按相同规则校验。
 */
object MachineFingerprint {

    fun compute(context: Context): String {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown"

        val model = Build.MODEL ?: "unknown"
        val raw = "$androidId|$model"

        return MessageDigest.getInstance("SHA-256")
            .digest(raw.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
            .take(32)
    }
}
