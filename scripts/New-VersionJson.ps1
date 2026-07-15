# New-VersionJson.ps1 — generate <ReleaseDir>\version.json (schema v3).
#
# Walks the release dir, computes SHA256 + size per file, writes the manifest.
# lowercase hex hashes, forward-slash paths, files sorted, no-BOM UTF-8.
# version.json itself is excluded from the walk.
#
#   powershell -File scripts\New-VersionJson.ps1 -ReleaseDir release\GameAgentMonitor -Version 0.3.32 [-Full]

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseDir,
    [Parameter(Mandatory)][string]$Version,
    [switch]$Full,                       # mark as a FULL (non-incremental) update
    [string]$MinVersion = '0.3.24',      # BASELINE: clients below this can't incrementally update (must full-install).
                                         # Bump ONLY when the update mechanism itself becomes incompatible — NOT per release.
    [string]$Channel    = 'stable',      # release channel (future beta/stable split)
    [switch]$Mandatory,                  # force the update (client hides "Later")
    [string]$Message    = ''             # optional user-facing note shown in the update modal
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path $ReleaseDir).Path

$entries = Get-ChildItem -Path $root -Recurse -File |
    Where-Object { $_.Name -ne 'version.json' } |
    ForEach-Object {
        [pscustomobject]@{
            Rel    = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
            Sha256 = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLower()
            Size   = $_.Length
        }
    } | Sort-Object Rel

$files = [ordered]@{}
foreach ($e in $entries) {
    $files[$e.Rel] = [ordered]@{ v = $Version; sha256 = $e.Sha256; size = $e.Size }
}

# ── Manifest signature (ECDSA P-256, schema v3) ──
# Canonical digest MUST match update_verify.cpp build_canon:
#   schema=3\n
#   app=<ver>\n
#   download_base=<url>\n
#   source=<url>\n   (each source, ordinal-sorted)
#   <path>\n<sha256>\n ...
$sig = ''
$tag = "v$Version"
$downloadBase = "https://gitee.com/Andyqwe44/mimic/raw/$tag/release/GameAgentMonitor/"
# Discovery URLs for "latest" manifest (main tip). Clients persist & prefer these.
$sources = [System.Collections.ArrayList]@(
    'https://gitee.com/Andyqwe44/mimic/raw/main/release/GameAgentMonitor/version.json',
    'https://raw.githubusercontent.com/Andyqwe44/Mimic/main/release/GameAgentMonitor/version.json'
)
$sources.Sort([System.StringComparer]::Ordinal)

$privPath = Join-Path $PSScriptRoot '.signing\ec_priv.b64'
if (Test-Path $privPath) {
    $rels = [System.Collections.ArrayList]@($entries | ForEach-Object { $_.Rel })
    $rels.Sort([System.StringComparer]::Ordinal)
    $shaMap = @{}; foreach ($e in $entries) { $shaMap[$e.Rel] = $e.Sha256 }
    $csb = New-Object System.Text.StringBuilder
    [void]$csb.Append("schema=3`n")
    [void]$csb.Append("app=$Version`n")
    [void]$csb.Append("download_base=$downloadBase`n")
    foreach ($src in $sources) {
        [void]$csb.Append("source=$src`n")
    }
    foreach ($r in $rels) {
        [void]$csb.Append($r);          [void]$csb.Append("`n")
        [void]$csb.Append($shaMap[$r]); [void]$csb.Append("`n")
    }
    $payload = [System.Text.Encoding]::UTF8.GetBytes($csb.ToString())
    $hash    = [System.Security.Cryptography.SHA256]::Create().ComputeHash($payload)
    $priv = [Convert]::FromBase64String([IO.File]::ReadAllText($privPath).Trim())
    $ecp = New-Object System.Security.Cryptography.ECParameters
    $ecp.Curve = [System.Security.Cryptography.ECCurve+NamedCurves]::nistP256
    $ecp.D = [byte[]]($priv[0..31])
    $pt = New-Object System.Security.Cryptography.ECPoint
    $pt.X = [byte[]]($priv[32..63])
    $pt.Y = [byte[]]($priv[64..95])
    $ecp.Q = $pt
    $signer = [System.Security.Cryptography.ECDsa]::Create($ecp)
    $sig = [Convert]::ToBase64String($signer.SignHash($hash))   # IEEE P1363 r||s (64B)
    Write-Host "manifest signed (ECDSA P-256 schema=3, $($rels.Count) files, $($sources.Count) sources)" -ForegroundColor DarkGray
} else {
    Write-Host "no signing key ($privPath) -> manifest unsigned (sig='')" -ForegroundColor DarkYellow
}

$manifest = [ordered]@{
    schema        = 3
    app           = $Version
    channel       = $Channel
    released      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    min_version   = $MinVersion
    mandatory     = [bool]$Mandatory
    message       = $Message
    full_update   = [bool]$Full
    # Tag-pinned file download base (immutable per release).
    download_base = $downloadBase
    # Manifest discovery URLs — clients try these after compile-time bootstrap.
    sources       = @($sources)
    updater       = [ordered]@{ path = 'bin/updater.exe' }
    sig           = $sig
    files         = $files
}

$json = $manifest | ConvertTo-Json -Depth 6
$outPath = Join-Path $root 'version.json'
[System.IO.File]::WriteAllText($outPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "version.json written (schema=3, $($entries.Count) files)" -ForegroundColor Green
