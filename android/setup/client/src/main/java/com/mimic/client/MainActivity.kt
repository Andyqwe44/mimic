package com.mimic.client

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Hosts shared/web (same React UI as Windows WebView2).
 * JS hostCall → MimicAndroid.post → AndroidHost → __mimicResolve.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var host: AndroidHost
    private val io = Executors.newCachedThreadPool()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        host = AndroidHost(this) { msg ->
            val payload = JSONObject.quote(msg.toString())
            webView.evaluateJavascript("window.__mimicPush && window.__mimicPush($payload)", null)
        }

        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true
        s.allowContentAccess = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.cacheMode = WebSettings.LOAD_DEFAULT

        WebView.setWebContentsDebuggingEnabled(true)
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                injectBridgeShim()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                injectBridgeShim()
            }
        }

        webView.addJavascriptInterface(JsBridge(), "MimicAndroid")
        webView.loadUrl("file:///android_asset/www/index.html")
    }

    private fun injectBridgeShim() {
        val js = """
            (function(){
              if (window.__mimicBridgeReady) return;
              window.__mimicBridgeReady = true;
              window.__mimicId = 0;
              window.__mimicPending = {};
              window.__mimicResolve = function(id, result) {
                var p = window.__mimicPending[id];
                if (!p) return;
                delete window.__mimicPending[id];
                p.resolve({ result: result });
              };
              window.__mimicReject = function(id, err) {
                var p = window.__mimicPending[id];
                if (!p) return;
                delete window.__mimicPending[id];
                p.reject(new Error(err || 'native error'));
              };
              window.__mimicPush = function(raw) {
                try {
                  var msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
                  if (window.__mimicOnNativePush) window.__mimicOnNativePush(msg);
                } catch (e) {}
              };
              window.Capacitor = {
                isNativePlatform: function(){ return true; },
                getPlatform: function(){ return 'android'; },
                Plugins: {
                  MimicHost: {
                    call: function(opts) {
                      return new Promise(function(resolve, reject) {
                        var id = ++window.__mimicId;
                        window.__mimicPending[id] = { resolve: resolve, reject: reject };
                        window.MimicAndroid.post(JSON.stringify({
                          id: id,
                          cmd: opts.cmd,
                          args: opts.args || {}
                        }));
                      });
                    }
                  }
                }
              };
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    inner class JsBridge {
        @JavascriptInterface
        fun post(msg: String) {
            io.execute {
                try {
                    val o = JSONObject(msg)
                    val id = o.getInt("id")
                    val cmd = o.getString("cmd")
                    val args = o.optJSONObject("args") ?: JSONObject()
                    val result = host.dispatch(cmd, args)
                    val resultJson = when (result) {
                        is JSONObject -> result.toString()
                        is org.json.JSONArray -> result.toString()
                        is String -> JSONObject.quote(result)
                        is Boolean -> if (result) "true" else "false"
                        is Number -> result.toString()
                        else -> JSONObject.quote(result.toString())
                    }
                    runOnUiThread {
                        webView.evaluateJavascript(
                            "window.__mimicResolve($id, $resultJson)",
                            null
                        )
                    }
                } catch (e: Exception) {
                    try {
                        val id = JSONObject(msg).optInt("id", -1)
                        if (id >= 0) {
                            runOnUiThread {
                                webView.evaluateJavascript(
                                    "window.__mimicReject($id, ${JSONObject.quote(e.message ?: "error")})",
                                    null
                                )
                            }
                        }
                    } catch (_: Exception) {
                    }
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
