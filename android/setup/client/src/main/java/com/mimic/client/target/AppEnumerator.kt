package com.mimic.client.target

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * Enumerate launchable activities for target picker (normal backend).
 */
object AppEnumerator {
    fun listLaunchable(context: Context): List<TargetDescriptor> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
        } else {
            pm.queryIntentActivities(intent, 0)
        }
        val self = context.packageName
        return resolved.mapNotNull { ri ->
            val ai = ri.activityInfo ?: return@mapNotNull null
            if (ai.packageName == self) return@mapNotNull null
            val label = try {
                ri.loadLabel(pm)?.toString() ?: ai.packageName
            } catch (_: Exception) {
                ai.packageName
            }
            TargetDescriptor(
                id = "app:${ai.packageName}/${ai.name}",
                kind = "app",
                title = label,
                packageName = ai.packageName,
                activity = ai.name,
                launch = true,
                capture = false,
                control = false,
                virtualDisplay = false,
            )
        }.sortedBy { it.title.lowercase() }
    }
}
