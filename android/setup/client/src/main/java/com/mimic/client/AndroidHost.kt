package com.mimic.client

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Native side of hostCall for shared/web — logs + APK update first;
 * PC-only commands return explicit stubs (铁律 5).
 */
class AndroidHost(
    private val context: Context,
    private val pushToJs: (JSONObject) -> Unit,
) {
    private val io = Executors.newCachedThreadPool()
    private val main = Handler(Looper.getMainLooper())
    private val tag = "MimicHost"
    private val prefs = context.getSharedPreferences("mimic_host", Context.MODE_PRIVATE)
    private val logFile = File(context.filesDir, "live.log")
    private val ring = ArrayDeque<String>(500)

    fun dispatch(cmd: String, args: JSONObject): Any {
        return when (cmd) {
            "get_version" -> readVersion()
            "show_window" -> jsonOk()
            "get_elevation" -> JSONObject().put("admin", false)
            "switch_permission" -> jsonErr("android: elevation N/A")
            "crash_log" -> {
                appendLog("crash", "${args.optString("kind")} | ${args.optString("message")}")
                jsonOk()
            }
            "log_ui_event" -> {
                appendLog("ui", args.optString("event", ""))
                jsonOk()
            }
            "read_live_log" -> JSONObject().put("lines", ring.joinToString("\n"))
            "read_logs" -> JSONObject().put("files", JSONArray())
            "clear_log" -> {
                ring.clear()
                logFile.writeText("")
                jsonOk()
            }
            "get_log_dir" -> JSONObject().put("dir", context.filesDir.absolutePath)
            "get_settings" -> {
                val raw = prefs.getString("settings", null)
                if (raw.isNullOrBlank()) JSONObject() else JSONObject(raw)
            }
            "set_settings" -> {
                val s = args.optJSONObject("settings") ?: args
                prefs.edit().putString("settings", s.toString()).apply()
                jsonOk()
            }
            "check_update" -> checkUpdate()
            "download_update" -> {
                // Async — progress via push; return ok immediately
                io.execute {
                    try {
                        downloadAndPromptInstall()
                    } catch (e: Exception) {
                        Log.e(tag, "download_update", e)
                        pushProgress("error", e.message ?: "download failed")
                    }
                }
                jsonOk()
            }
            "clear_staging" -> {
                File(context.cacheDir, "updates").deleteRecursively()
                jsonOk()
            }
            "peer_probe" -> peerProbe(args.optString("url", DEFAULT_BOOTSTRAP))
            "peer_status" -> JSONObject()
                .put("ok", true)
                .put("logged_in", false)
                .put("role", "idle")
            "peer_logout" -> jsonOk()
            "get_gates" -> JSONObject()
                .put("allow_stream", false)
                .put("accept_control", false)
            "set_stream_gate", "set_control_gate", "set_exclude_self" -> jsonOk()
            "get_agent_status" -> JSONObject().put("connected", false)
            "get_server_status" -> JSONObject().put("connected", false)
            "screen_info" -> JSONObject()
                .put("x", 0).put("y", 0)
                .put("w", context.resources.displayMetrics.widthPixels)
                .put("h", context.resources.displayMetrics.heightPixels)
            "list_windows", "list_processes", "list_desktops" -> JSONArray()
            else -> jsonErr("android: unsupported cmd '$cmd'")
        }
    }

    private fun checkUpdate(): JSONObject {
        val local = readVersion()
        val manifest = httpGetJson(CDN_VERSION) ?: return JSONObject()
            .put("ok", false)
            .put("error", "version.json unreachable")
            .put("current", local)
        val remote = manifest.optString("app", "")
        val apkName = manifest.optString("client_apk", manifest.optString("apk", ""))
        val base = manifest.optString("download_base", CDN_BASE).trimEnd('/') + "/"
        val has = compareSemver(remote, local) > 0
        val o = JSONObject()
            .put("ok", true)
            .put("current", local)
            .put("latest", if (remote.isNotBlank()) remote else local)
            .put("has_update", has)
            .put("mode", "full")
            .put("message", manifest.optString("message", ""))
            .put("name", "Mimic Android $remote")
            .put("body", "APK update from CDN (same package overwrite — not OS A/B slots)")
        if (has && apkName.isNotBlank()) {
            val size = tryHeadSize(base + apkName)
            val diff = JSONArray().put(
                JSONObject()
                    .put("path", apkName)
                    .put("size", size)
                    .put("dl", size)
            )
            o.put("diff", diff)
        } else {
            o.put("diff", JSONArray())
        }
        return o
    }

    private fun downloadAndPromptInstall() {
        val manifest = httpGetJson(CDN_VERSION) ?: throw Exception("version.json unreachable")
        val base = manifest.optString("download_base", CDN_BASE).trimEnd('/') + "/"
        val apkName = manifest.optString("client_apk", manifest.optString("apk", ""))
        if (apkName.isBlank()) throw Exception("client_apk missing")
        val url = base + apkName
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val out = File(dir, apkName)
        pushProgress("download", apkName, 0, 1)
        httpDownload(url, out) { read, total ->
            if (total > 0) {
                pushBytes(apkName, read, total)
            }
        }
        pushProgress("done", apkName)
        main.post { promptInstall(out) }
    }

    private fun promptInstall(apk: File) {
        if (Build.VERSION.SDK_INT >= 26 &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            val i = Intent(
                android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        }
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apk
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun peerProbe(baseUrl: String): JSONObject {
        val health = httpGetJson("$baseUrl/health")
        val cluster = try {
            httpGetJson("$baseUrl/api/cluster")
        } catch (_: Exception) {
            null
        }
        val o = JSONObject().put("ok", true).put("url", baseUrl).put("reachable", health != null)
        if (health != null) {
            o.put("role", health.optString("role", ""))
            o.put("instanceId", health.optString("instanceId", ""))
        }
        val nodeCount = when {
            cluster?.has("nodeCount") == true -> cluster.getInt("nodeCount")
            cluster?.optJSONArray("nodes") != null -> cluster.getJSONArray("nodes").length()
            health?.has("nodeCount") == true -> health.getInt("nodeCount")
            else -> 0
        }
        o.put("node_count", nodeCount)
        return o
    }

    private fun appendLog(tagName: String, msg: String) {
        val ts = SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date())
        val line = "[$ts] [$tagName] $msg"
        synchronized(ring) {
            if (ring.size >= 500) ring.removeFirst()
            ring.addLast(line)
        }
        try {
            logFile.appendText(line + "\n")
        } catch (_: Exception) {
        }
        Log.i(tag, msg)
        // Push to shared/web LogManager (same shape as WebView2)
        val push = JSONObject()
            .put("type", "log")
            .put("ts", ts)
            .put("tag", tagName)
            .put("msg", msg)
            .put("count", 1)
        main.post { pushToJs(push) }
    }

    private fun pushProgress(phase: String, file: String = "", doneFiles: Int = 0, totalFiles: Int = 1) {
        val o = JSONObject()
            .put("type", "update_progress")
            .put("phase", phase)
            .put("current_file", doneFiles)
            .put("total_files", totalFiles)
            .put("skipped_files", 0)
            .put("file", file)
            .put("done_bytes", 0)
            .put("total_bytes", 0)
            .put("skipped_bytes", 0)
        if (phase == "error") o.put("error_file", file)
        main.post { pushToJs(o) }
    }

    private fun pushBytes(file: String, done: Long, total: Long) {
        val o = JSONObject()
            .put("type", "update_progress")
            .put("phase", "download")
            .put("current_file", 1)
            .put("total_files", 1)
            .put("skipped_files", 0)
            .put("file", file)
            .put("done_bytes", done)
            .put("total_bytes", total)
            .put("skipped_bytes", 0)
        main.post { pushToJs(o) }
    }

    private fun readVersion(): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0.0.0"
        } catch (_: Exception) {
            "0.0.0"
        }
    }

    private fun jsonOk() = JSONObject().put("ok", true)
    private fun jsonErr(msg: String) = JSONObject().put("ok", false).put("error", msg)

    private fun httpGetJson(url: String): JSONObject? {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000
            readTimeout = 15000
            requestMethod = "GET"
        }
        return try {
            if (conn.responseCode !in 200..299) return null
            JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
        } finally {
            conn.disconnect()
        }
    }

    private fun tryHeadSize(url: String): Long {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 8000
            requestMethod = "HEAD"
        }
        return try {
            if (conn.responseCode in 200..299) conn.contentLengthLong.coerceAtLeast(0) else 0
        } catch (_: Exception) {
            0
        } finally {
            conn.disconnect()
        }
    }

    private fun httpDownload(url: String, dest: File, onProgress: (Long, Long) -> Unit) {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 180000
            requestMethod = "GET"
        }
        try {
            if (conn.responseCode !in 200..299) throw Exception("HTTP ${conn.responseCode}")
            val total = conn.contentLengthLong
            conn.inputStream.use { input ->
                FileOutputStream(dest).use { output ->
                    val buf = ByteArray(64 * 1024)
                    var readTotal = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        output.write(buf, 0, n)
                        readTotal += n
                        onProgress(readTotal, total)
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        const val DEFAULT_BOOTSTRAP = "http://47.107.43.5:8443"
        const val CDN_BASE = "http://47.107.43.5/mimic/android/"
        const val CDN_VERSION = "http://47.107.43.5/mimic/android/version.json"

        fun compareSemver(a: String, b: String): Int {
            fun parts(s: String) = s.trim().removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
            val pa = parts(a)
            val pb = parts(b)
            val n = maxOf(pa.size, pb.size)
            for (i in 0 until n) {
                val x = pa.getOrElse(i) { 0 }
                val y = pb.getOrElse(i) { 0 }
                if (x != y) return x - y
            }
            return 0
        }
    }
}
