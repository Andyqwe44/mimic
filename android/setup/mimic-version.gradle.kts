// Shared Mimic Android version — SSOT is android/version.json (铁律 8).
// Applied by :client and :setup. Optional -PmimicAppVersion / -PmimicVersionCode override.

import groovy.json.JsonSlurper
import java.util.regex.Pattern

fun mimicSemverToCode(ver: String): Int {
    val m = Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)").matcher(ver.trim())
    if (!m.find()) return 1
    val major = m.group(1).toInt()
    val minor = m.group(2).toInt()
    val patch = m.group(3).toInt()
    // 0.1.18 → 1018; always > legacy hardcoded 14
    return major * 1_000_000 + minor * 1_000 + patch
}

val propName = (findProperty("mimicAppVersion") as String?)?.trim().orEmpty()
val propCode = (findProperty("mimicVersionCode") as String?)?.trim().orEmpty()

var resolvedName = if (propName.isNotEmpty()) propName else ""
var resolvedCode = if (propCode.isNotEmpty()) propCode.toIntOrNull() ?: 0 else 0

if (resolvedName.isEmpty()) {
    val vf = rootProject.file("../version.json")
    if (vf.exists()) {
        @Suppress("UNCHECKED_CAST")
        val json = JsonSlurper().parse(vf) as Map<String, Any?>
        val app = json["app"]?.toString()?.trim().orEmpty()
        if (app.isNotEmpty()) resolvedName = app
    }
}

if (resolvedName.isEmpty()) {
    resolvedName = "0.1.18"
}

if (resolvedCode <= 0) {
    resolvedCode = mimicSemverToCode(resolvedName)
}

extra["mimicVersionName"] = resolvedName
extra["mimicVersionCode"] = resolvedCode

logger.lifecycle("Mimic Android versionName=$resolvedName versionCode=$resolvedCode")
