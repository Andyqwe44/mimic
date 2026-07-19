# Mimic Android — thin Setup → CDN Client（对齐 PC）

和 PC 一样分两层：

| 角色 | 文件 | 放哪 |
|------|------|------|
| **Setup（薄安装器）** | `MimicAndroid_Setup_v*.apk` | Gitee Release / 也可放 CDN |
| **Client（完整应用）** | `MimicClient_Android_v*.apk` | **只放 CDN** `http://47.107.43.5/mimic/android/` |

```
手机下载 Setup.apk（小入口）
  → 打开 Mimic Setup
  → GET CDN /android/version.json
  → 下载 client_apk
  → 系统安装 Mimic Client
```

对应 PC：`MimicClient_Setup.exe` → CDN `payload.zip`。

## 工程

```
android/setup/     # Gradle 双模块
  setup/           # com.mimic.setup — 薄安装器
  client/          # com.mimic.client — WebView + shared/web + native host
    …/AndroidHost.kt          # hostCall 分发（gate / target / peer / capture）
    …/capability/              # normal | shizuku | root（显式，无静默回退）
    …/target/                  # list_targets / AppEnumerator / AppLauncher
    …/capture/                 # MediaProjection + MediaCodec H.264 Annex-B
    …/input/                   # AccessibilityService（普通档）
    …/peer/                    # HTTP/WS 信令 + LAN type=1/2 帧
```

**能力档：** 普通 = MediaProjection + 无障碍（仅 `display:0` 整屏）；**Shizuku** = 独立 VirtualDisplay 沙箱（`app:*` 硬隔离）。Root 接口预留未接。
**Peer：** 登录/邀请/LAN offer 已接线；与 PC 共用 peer proto v2（`list_targets` / `id`）。

**版本真相源：** `android/version.json`（+ `android/package.json`）。`Build-Android.ps1` / `mimic-version.gradle.kts` 写入 APK `versionName`/`versionCode`；UI `get_version` 读 PackageManager，勿再手改 `build.gradle.kts` 里的版本号。

## 构建

```powershell
powershell -File scripts\Build-Android.ps1
# 产物: release\MimicAndroid\*.apk + version.json
```

需要本机已装 **Android Studio（SDK）**；日常可用命令行 Gradle，不必每次开 Studio。

## Setup 会不会重复下载？

会检测。`<queries>` 声明 `com.mimic.client` 后，Setup 可用 `PackageManager` 读已装版本（**不需要** `QUERY_ALL_PACKAGES`）。

- 已装且 **≥ CDN `app`** → 跳过下载，直接打开 Mimic  
- 已装但更旧 → 下载并覆盖安装  
- 按钮「Re-download」可强制重下  

## 应用内更新（全量 APK + 按流量进度）

安卓安装单元是**整包签名 APK**（`PackageInstaller`），没有 PC 那种「多文件 sha256 覆盖目录」的 updater。

当前：

1. CDN `version.json`：`full_update: true` + `client_apk` + `client_sha256` + `client_size`
2. 下载整包 APK → **按字节推送进度**（`done_bytes`/`total_bytes`）→ SHA-256 → 系统安装器覆盖安装
3. UI / 原生改动都打进 APK（`shared/web` 在 assets）

### 为何游戏能「增量」而我们还不行

| 技术 | 谁在用 | 说明 |
|------|--------|------|
| **Play 差分 / bsdiff** | Google Play、部分渠道 | 商店侧对两个 APK 做二进制差分；客户端下 patch 再合成。自建 CDN 需存旧包 + 生成 patch + 原生 `bspatch` |
| **资源分包** | 大型手游 | 母包小，玩法资源 OBB / AssetBundle / PAD 另下；可按文件增量 |
| **热更 JS/资源** | 部分 Hybrid / Unity | 可写目录覆盖资源；**不改** native so/Kotlin |

Mimic 当前是整包 Hybrid（Web 在 APK assets），所以发版默认仍是**全量 APK**。下一步若要明显减小流量：优先做 **www 热更**（仅前端变更时下 `www.zip` 解压到可写目录，WebView 优先加载），Kotlin/权限变更仍走整包。

Settings → Check Update 走 `check_update` / `download_update`（与 PC 同 UI；进度条按**流量字节**）。

## 手机测试

1. 装 `MimicAndroid_Setup_v*.apk`（Gitee / CDN）。  
2. 打开 Setup → 从 CDN 装 Client（或已最新则直接打开）。  
3. Client 应显示与 PC 相同的 React UI（shared/web）。  
4. 测：**日志面板**、**Settings → Check Update**、Peer Probe Bootstrap。

## Cursor / Android Studio

- **不用「连接」Studio**；Cursor 改代码，终端跑 `Build-Android.ps1`。
- Studio 用于：SDK 管理、真机调试、签名配置。
- Cursor 可装 Kotlin 语法扩展，**不能**替代完整 Android 构建链。
