package com.mimic.client.input

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log

/**
 * System "Show taps" (developer option) — same dots as screen recording.
 * Toggle for remote-control sessions; always restore the previous value.
 */
object ShowTouchesHelper {
    private const val TAG = "ShowTouches"
    private const val KEY = "show_touches"

    @Volatile private var saved: Int? = null
    @Volatile private var weEnabled = false

    fun ensurePermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        if (Settings.System.canWrite(context)) return true
        try {
            val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "open WRITE_SETTINGS", e)
        }
        return false
    }

    /** Enable system touch dots for a controlled session. Idempotent. */
    fun enableForSession(context: Context): Boolean {
        if (weEnabled) return true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(context)) {
            Log.w(TAG, "WRITE_SETTINGS not granted — cannot enable show_touches")
            return false
        }
        return try {
            val cr = context.contentResolver
            val cur = Settings.System.getInt(cr, KEY, 0)
            saved = cur
            if (cur != 1) {
                Settings.System.putInt(cr, KEY, 1)
            }
            weEnabled = true
            Log.i(TAG, "show_touches=1 (was=$cur)")
            true
        } catch (e: Exception) {
            Log.w(TAG, "enable failed", e)
            false
        }
    }

    /** Restore pre-session value. Safe to call multiple times. */
    fun restore(context: Context) {
        if (!weEnabled) return
        val prev = saved ?: 0
        weEnabled = false
        saved = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.System.canWrite(context)) {
            Log.w(TAG, "cannot restore show_touches (no WRITE_SETTINGS)")
            return
        }
        try {
            Settings.System.putInt(context.contentResolver, KEY, prev)
            Log.i(TAG, "show_touches restored to $prev")
        } catch (e: Exception) {
            Log.w(TAG, "restore failed", e)
        }
    }
}
