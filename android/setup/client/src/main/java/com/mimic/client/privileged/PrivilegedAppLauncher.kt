package com.mimic.client.privileged

import android.app.ActivityOptions
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import org.json.JSONObject

/** Launch an activity onto a specific logical display (shell/root). */
object PrivilegedAppLauncher {
    private const val TAG = "MimicPrivLaunch"

    fun launchOnDisplay(
        context: Context,
        packageName: String,
        activity: String?,
        displayId: Int,
        forceStop: Boolean = true,
    ): JSONObject {
        if (displayId < 0) {
            return JSONObject().put("ok", false).put("error", "invalid displayId")
        }
        return try {
            if (forceStop) {
                runCatching { forceStopPackage(packageName) }
            }
            val intent = if (!activity.isNullOrBlank()) {
                Intent(Intent.ACTION_MAIN).apply {
                    component = ComponentName(packageName, activity)
                    addCategory(Intent.CATEGORY_LAUNCHER)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
                }
            } else {
                context.packageManager.getLaunchIntentForPackage(packageName)?.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK)
                } ?: return JSONObject().put("ok", false).put("error", "no launch intent for $packageName")
            }
            val opts = ActivityOptions.makeBasic()
            if (Build.VERSION.SDK_INT >= 26) {
                opts.launchDisplayId = displayId
            }
            context.startActivity(intent, opts.toBundle())
            Log.i(TAG, "launched $packageName on display $displayId")
            JSONObject().put("ok", true).put("displayId", displayId).put("packageName", packageName)
        } catch (e: Exception) {
            Log.w(TAG, "ActivityOptions launch failed, try am --display", e)
            shellAmStart(packageName, activity, displayId)
        }
    }

    private fun forceStopPackage(packageName: String) {
        try {
            val proc = Runtime.getRuntime().exec(arrayOf("am", "force-stop", packageName))
            proc.waitFor()
            Log.i(TAG, "force-stop $packageName exit=${proc.exitValue()}")
        } catch (e: Exception) {
            Log.w(TAG, "forceStop $packageName", e)
        }
    }

    private fun shellAmStart(packageName: String, activity: String?, displayId: Int): JSONObject {
        return try {
            val comp = if (!activity.isNullOrBlank()) "$packageName/$activity" else packageName
            val cmd = arrayOf("am", "start", "--display", displayId.toString(), "-n", comp)
            val proc = Runtime.getRuntime().exec(cmd)
            val code = proc.waitFor()
            if (code == 0) JSONObject().put("ok", true).put("displayId", displayId).put("via", "am")
            else JSONObject().put("ok", false).put("error", "am start exit=$code")
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "am start failed")
        }
    }
}
