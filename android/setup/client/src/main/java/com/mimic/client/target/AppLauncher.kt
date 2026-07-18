package com.mimic.client.target

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * Launch a target app on the default display (normal backend).
 * Privileged backends will add displayId / force-stop later.
 */
object AppLauncher {
    fun launch(context: Context, packageName: String, activity: String?): JSONObject {
        return try {
            val intent = if (!activity.isNullOrBlank()) {
                Intent(Intent.ACTION_MAIN).apply {
                    component = ComponentName(packageName, activity)
                    addCategory(Intent.CATEGORY_LAUNCHER)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            } else {
                context.packageManager.getLaunchIntentForPackage(packageName)?.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                } ?: return JSONObject()
                    .put("ok", false)
                    .put("error", "no launch intent for $packageName")
            }
            context.startActivity(intent)
            JSONObject().put("ok", true).put("packageName", packageName)
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "launch failed")
        }
    }
}
