package com.mimic.client.privileged

import android.annotation.SuppressLint
import android.app.ActivityOptions
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.IInterface
import android.util.Log
import android.view.Display
import org.json.JSONObject
import java.lang.reflect.Method

/**
 * Launch activities onto a VirtualDisplay as shell — mirrors MAA-Meow ActivityUtils.
 * Never use Context.startActivity + launchDisplayId (throws
 * "packageName must match the calling uid" under Shizuku UserService).
 */
@SuppressLint("PrivateApi", "DiscouragedPrivateApi")
object PrivilegedAppLauncher {
    private const val TAG = "MimicPrivLaunch"
    private const val SHELL_PKG = "com.android.shell"
    private const val USER_CURRENT = -2

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
            if (forceStop) forceStopPackage(packageName)

            val intent = buildLaunchIntent(context, packageName, activity)
                ?: return JSONObject().put("ok", false).put("error", "no launch intent for $packageName")

            val opts = ActivityOptions.makeBasic()
            if (Build.VERSION.SDK_INT >= 26 && displayId != Display.DEFAULT_DISPLAY) {
                opts.launchDisplayId = displayId
            }
            val bundle = opts.toBundle()

            val amRet = startActivityAsShell(intent, bundle)
            if (amRet >= 0) {
                Log.i(TAG, "IActivityManager start ok ret=$amRet $packageName display=$displayId")
                return JSONObject()
                    .put("ok", true)
                    .put("displayId", displayId)
                    .put("packageName", packageName)
                    .put("via", "iam")
            }
            Log.w(TAG, "IActivityManager ret=$amRet → am --display fallback")
            shellAmStart(packageName, activity, displayId, intent)
        } catch (e: Exception) {
            Log.w(TAG, "launch failed, am fallback", e)
            shellAmStart(packageName, activity, displayId, null)
        }
    }

    private fun buildLaunchIntent(
        context: Context,
        packageName: String,
        activity: String?,
    ): Intent? {
        val intent = if (!activity.isNullOrBlank()) {
            Intent(Intent.ACTION_MAIN).apply {
                component = ComponentName(packageName, activity)
                addCategory(Intent.CATEGORY_LAUNCHER)
            }
        } else {
            context.packageManager.getLaunchIntentForPackage(packageName)
        } ?: return null
        intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_MULTIPLE_TASK or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
        )
        return intent
    }

    private fun forceStopPackage(packageName: String) {
        try {
            val am = activityManager()
            if (am != null) {
                val m = am.javaClass.getMethod("forceStopPackage", String::class.java, Int::class.javaPrimitiveType)
                m.invoke(am, packageName, USER_CURRENT)
                Log.i(TAG, "forceStopPackage $packageName via IAM")
                return
            }
        } catch (e: Exception) {
            Log.w(TAG, "IAM forceStop failed", e)
        }
        try {
            val proc = Runtime.getRuntime().exec(arrayOf("am", "force-stop", packageName))
            proc.waitFor()
            Log.i(TAG, "am force-stop $packageName exit=${proc.exitValue()}")
        } catch (e: Exception) {
            Log.w(TAG, "forceStop $packageName", e)
        }
    }

    /** @return startActivityAsUser result code; negative = failure; -999 = reflection unavailable. */
    private fun startActivityAsShell(intent: Intent, options: Bundle?): Int {
        return try {
            val am = activityManager() ?: return -999
            val method = resolveStartActivityAsUser(am)
            val ret = method.invoke(
                am,
                /* caller */ null,
                /* callingPackage */ SHELL_PKG,
                /* intent */ intent,
                /* resolvedType */ null,
                /* resultTo */ null,
                /* resultWho */ null,
                /* requestCode */ 0,
                /* startFlags */ 0,
                /* profilerInfo */ null,
                /* bOptions */ options,
                /* userId */ USER_CURRENT,
            ) as Int
            ret
        } catch (e: Exception) {
            Log.w(TAG, "startActivityAsShell", e)
            -1
        }
    }

    private fun resolveStartActivityAsUser(am: IInterface): Method {
        val iAppThread = Class.forName("android.app.IApplicationThread")
        val profilerInfo = Class.forName("android.app.ProfilerInfo")
        return am.javaClass.getMethod(
            "startActivityAsUser",
            iAppThread,
            String::class.java,
            Intent::class.java,
            String::class.java,
            IBinder::class.java,
            String::class.java,
            Int::class.javaPrimitiveType,
            Int::class.javaPrimitiveType,
            profilerInfo,
            Bundle::class.java,
            Int::class.javaPrimitiveType,
        )
    }

    private fun activityManager(): IInterface? {
        return try {
            val sm = Class.forName("android.os.ServiceManager")
            val getService = sm.getDeclaredMethod("getService", String::class.java)
            val binder = getService.invoke(null, "activity") as? IBinder ?: return null
            // Prefer modern stub; fall back to ActivityManagerNative.
            try {
                val stub = Class.forName("android.app.IActivityManager\$Stub")
                val asInterface = stub.getMethod("asInterface", IBinder::class.java)
                asInterface.invoke(null, binder) as IInterface
            } catch (_: ClassNotFoundException) {
                val native = Class.forName("android.app.ActivityManagerNative")
                val asInterface = native.getDeclaredMethod("asInterface", IBinder::class.java)
                asInterface.invoke(null, binder) as IInterface
            }
        } catch (e: Exception) {
            Log.w(TAG, "activityManager()", e)
            null
        }
    }

    private fun shellAmStart(
        packageName: String,
        activity: String?,
        displayId: Int,
        intent: Intent?,
    ): JSONObject {
        return try {
            val args = if (intent != null) {
                val uri = intent.toUri(Intent.URI_INTENT_SCHEME)
                if (displayId == Display.DEFAULT_DISPLAY) {
                    arrayOf("am", "start", uri)
                } else {
                    arrayOf("am", "start", "--display", displayId.toString(), uri)
                }
            } else {
                val comp = if (!activity.isNullOrBlank()) "$packageName/$activity" else packageName
                arrayOf("am", "start", "--display", displayId.toString(), "-n", comp)
            }
            Log.i(TAG, "exec: ${args.joinToString(" ")}")
            val proc = Runtime.getRuntime().exec(args)
            val code = proc.waitFor()
            val err = proc.errorStream.bufferedReader().use { it.readText() }.trim()
            if (err.isNotEmpty()) Log.w(TAG, "am stderr: $err")
            if (code == 0) {
                JSONObject().put("ok", true).put("displayId", displayId).put("via", "am")
            } else {
                JSONObject().put("ok", false).put("error", "am start exit=$code${if (err.isNotEmpty()) ": $err" else ""}")
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "am start failed")
        }
    }
}
