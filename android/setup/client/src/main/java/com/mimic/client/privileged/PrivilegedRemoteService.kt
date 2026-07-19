package com.mimic.client.privileged

import android.content.Context
import android.os.RemoteException
import android.util.Log
import com.mimic.client.IMimicFrameCallback
import com.mimic.client.IMimicPrivileged
import org.json.JSONObject

/**
 * Shizuku UserService entry — runs in a separate process (suffix "priv") as shell.
 * Owns VirtualDisplay sandbox + encode + inject for app:* targets.
 */
class PrivilegedRemoteService : IMimicPrivileged.Stub {
    private val tag = "MimicPrivSvc"
    private var appContext: Context? = null
    private var encoder: PrivilegedVdEncoder? = null
    private var frameCb: IMimicFrameCallback? = null
    private var sessionW = 0
    private var sessionH = 0

    /** Shizuku may construct with Context. */
    constructor(context: Context) {
        appContext = context.applicationContext
        Log.i(tag, "constructed with Context")
    }

    constructor() {
        Log.i(tag, "constructed default")
    }

    override fun startAppSession(
        packageName: String?,
        activity: String?,
        width: Int,
        height: Int,
        dpi: Int,
        cb: IMimicFrameCallback?,
    ): String {
        val ctx = appContext
            ?: return JSONObject().put("ok", false).put("error", "no context").toString()
        if (packageName.isNullOrBlank()) {
            return JSONObject().put("ok", false).put("error", "missing packageName").toString()
        }
        stopSessionInternal()
        frameCb = cb
        val dm = ctx.resources.displayMetrics
        val w = if (width > 0) width else dm.widthPixels
        val h = if (height > 0) height else dm.heightPixels
        val d = if (dpi > 0) dpi else dm.densityDpi
        sessionW = w
        sessionH = h
        val enc = PrivilegedVdEncoder(
            context = ctx,
            width = w,
            height = h,
            dpi = d,
            onFrame = { packed ->
                try {
                    frameCb?.onFrame(packed)
                } catch (e: RemoteException) {
                    Log.w(tag, "frame callback dead", e)
                }
            },
            onEnded = { reason ->
                try {
                    frameCb?.onSessionEnded(reason)
                } catch (_: Exception) {
                }
            },
        )
        val started = enc.start()
        if (!started.optBoolean("ok", false)) {
            enc.stop()
            return started.toString()
        }
        encoder = enc
        val displayId = enc.displayId
        val launch = PrivilegedAppLauncher.launchOnDisplay(
            ctx, packageName, activity?.ifBlank { null }, displayId, forceStop = true,
        )
        if (!launch.optBoolean("ok", false)) {
            stopSessionInternal()
            return launch.put("error", "launch failed: ${launch.optString("error")}").toString()
        }
        return JSONObject()
            .put("ok", true)
            .put("displayId", displayId)
            .put("w", started.optInt("w", w))
            .put("h", started.optInt("h", h))
            .put("packageName", packageName)
            .put("method", "virtualdisplay")
            .toString()
    }

    override fun stopSession() {
        stopSessionInternal()
    }

    override fun injectJson(actionJson: String?): String {
        val enc = encoder
            ?: return JSONObject().put("ok", false).put("error", "no active session").toString()
        return try {
            val action = JSONObject(actionJson ?: "{}")
            PrivilegedInputInjector.injectNormalized(
                action, sessionW, sessionH, enc.displayId,
            ).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "inject parse failed").toString()
        }
    }

    override fun getDisplayId(): Int = encoder?.displayId ?: -1

    override fun isRunning(): Boolean = encoder != null && (encoder?.displayId ?: -1) >= 0

    override fun requestKeyframe() {
        encoder?.requestKeyframe()
    }

    private fun stopSessionInternal() {
        try { encoder?.stop() } catch (_: Exception) {}
        encoder = null
        frameCb = null
        sessionW = 0
        sessionH = 0
    }

    fun destroy() {
        stopSessionInternal()
        Log.i(tag, "destroy")
    }
}
