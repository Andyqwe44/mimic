# Release.ps1 — one-command release pipeline (all PowerShell).
#
# Replaces release.sh + build_release.cmd. The version is read from version.h
# (铁律 8, single source), so bumping that file is the only manual edit.
#
#   powershell -File scripts\Release.ps1            # full: build -> verify -> push -> Gitee
#   powershell -File scripts\Release.ps1 -DryRun    # build -> verify only (no git, no publish)
#
# Chain: frontend(npm) -> native build(Build.ps1) -> assemble release\ ->
#        version.json -> installer(ISCC) -> isolated verify -> git push -> Gitee -> raw check.

[CmdletBinding()]
param(
    [switch]$DryRun,        # skip git push + Gitee publish (build + verify only)
    [switch]$Interactive    # human Y/N at the verify gate instead of log polling
)

. "$PSScriptRoot\lib\Common.ps1"

$root = Get-RepoRoot
$ver = Get-AppVersion
Write-Step "Release v$ver$(if ($DryRun) { ' (dry-run: no git, no publish)' })"

# 1. Frontend — before the native build; monitor_app stages dist into build\frontend.
Write-Step 'frontend (npm run build)'
Push-Location (Join-Path $root 'monitor_web')
try { npm run build; if ($LASTEXITCODE) { throw 'npm build failed' } } finally { Pop-Location }
Write-Ok 'dist'

# 2. Native modules — one VS Dev Shell builds libs + app and stages
#    monitor_app\build\{bin,frontend,config} (the package layout). Throws on error.
& "$PSScriptRoot\Build.ps1" -Module all

# 3. Assemble release\GameAgentMonitor from monitor_app\build\{bin,frontend,config}.
#    Copy only those three subdirs — NOT build\ root, which also holds loose
#    compile artifacts (app.res + *.obj) that must not ship in the package.
Write-Step 'assemble release'
$rel = Join-Path $root 'release\GameAgentMonitor'
if (Test-Path $rel) { Remove-Item -Recurse -Force $rel }
New-Item -ItemType Directory -Force -Path $rel | Out-Null
foreach ($sub in 'bin', 'frontend', 'config') {
    Copy-Item (Join-Path $root "monitor_app\build\$sub") $rel -Recurse -Force
}
Write-Ok 'release\GameAgentMonitor'

# 3b. Normalize text files to LF before hashing. Gitee/GitHub raw serve git blobs
#     as LF; a CRLF checkout would make version.json sha256 disagree with downloads
#     (seen on config/settings.default.json: 451 CRLF vs 432 LF → update fails).
Write-Step 'normalize release EOL (LF)'
$textExt = @('.json', '.html', '.css', '.js', '.mjs', '.cjs', '.map', '.txt', '.md', '.svg', '.xml')
$nFix = 0
Get-ChildItem -Path $rel -Recurse -File | Where-Object {
    $textExt -contains $_.Extension.ToLowerInvariant()
} | ForEach-Object {
    $bytes = [IO.File]::ReadAllBytes($_.FullName)
    $hasCr = $false
    foreach ($b in $bytes) { if ($b -eq 13) { $hasCr = $true; break } }
    if ($hasCr) {
        $out = New-Object System.Collections.Generic.List[byte] ($bytes.Length)
        foreach ($b in $bytes) { if ($b -ne 13) { [void]$out.Add($b) } }
        [IO.File]::WriteAllBytes($_.FullName, $out.ToArray())
        $script:nFix++
    }
}
Write-Ok "LF-normalized $nFix file(s)"

# 4. version.json (SHA256 manifest).
# Schema 2 (default): 0.3.31 jump-pad clients (KNOWN_SCHEMA=2) can still incremental-update.
# Flip to -Schema 3 only after the fleet is on >=0.3.32 (otherwise they get needs_full_installer).
$migMsg = 'Repo migrated to mimic. After install, click Check Update again. Multi-round manual updates are required.'
if ($ver -eq '0.3.32' -or $ver -eq '0.3.31') {
    # UTF-8 via Base64 so the script stays ASCII-safe under Windows PowerShell 5.1.
    $migMsg = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(
        '5LuT5bqT5bey6L+B56e75YiwIG1pbWlj44CC5pys5qyh5Y+v6IO95piv6Lez5p2/5Y2H57qn55qE5LiA5q2l77ya5a6J6KOF5a6M5oiQ5ZCO6K+35YaN5qyh54K55Ye744CM5qOA5p+l5pu05paw44CN44CC6ZyA6KaB5aSa6L2u5omL5Yqo5pON5L2c5omN6IO95Y2H5Yiw5pyA5paw54mI77yM5Y+q5pu05paw5LiA5qyh5LiN562J5LqO5bey5Yiw5pyA5paw44CC'))
}
& "$PSScriptRoot\New-VersionJson.ps1" -ReleaseDir $rel -Version $ver -Schema 2 -JumpPad '0.3.31' -Message $migMsg

# 5. Installer (Inno Setup).
Write-Step 'installer (ISCC)'
$iscc = 'C:\Program Files\Inno Setup 6\ISCC.exe'
if (Test-Path $iscc) {
    & $iscc "/DMyAppVersion=$ver" (Join-Path $root 'installer\setup.iss') | Out-Null
    if ($LASTEXITCODE) { Write-Warn2 'ISCC failed' } else { Write-Ok "GameAgentMonitor_Setup_v$ver.exe" }
}
else { Write-Warn2 'Inno Setup 6 not found - installer skipped' }

# 6. Isolated verify gate - run as a CHILD process so its exit code is isolated
#    (a bare exit in the same runspace would kill this script).
Write-Step 'isolated verify (gate)'
$vArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$PSScriptRoot\Verify.ps1", '-Version', $ver)
if ($Interactive) { $vArgs += '-Interactive' }
& powershell.exe @vArgs
if ($LASTEXITCODE -ne 0) { throw 'isolated verification failed - nothing pushed, nothing published' }

if ($DryRun) {
    Write-Host "`n==================== dry-run $ver OK (built + verified; not published) ====================" -ForegroundColor Green
    return
}

# 7. Git commit + tag + push. Native git writes progress/banners to stderr; under
#    $ErrorActionPreference='Stop' that becomes a terminating RemoteException, so
#    relax it here and check $LASTEXITCODE explicitly on the pushes that matter.
#    `git add -A` folds source + docs into the commit (the release binaries are
#    already tracked); `-f` force-adds the release payload past *.dll/*.exe ignores.
Write-Step 'git commit + tag + push'
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
    git add -A
    git add -f release\GameAgentMonitor monitor_app\src\version.h installer\setup.iss
    git commit -m "release: v$ver" 2>&1 | Write-Host   # no-op if nothing staged; fine
    git tag -f "v$ver" 2>&1 | Write-Host               # (re)create local tag
    git push origin main 2>&1 | Write-Host
    if ($LASTEXITCODE) { throw "git push main failed (exit $LASTEXITCODE)" }
    git push -f origin "refs/tags/v${ver}" 2>&1 | Write-Host   # force: overwrite a stale remote tag
    if ($LASTEXITCODE) { throw "git tag push failed (exit $LASTEXITCODE)" }

    # Best-effort GitHub mirror sync (origin=Gitee mimic is source of truth).
    # Failure must NOT block the Gitee release — China networks may block github.com.
    git push github main 2>&1 | Write-Host
    if ($LASTEXITCODE) {
        Write-Warn2 "git push github main failed (exit $LASTEXITCODE) — Gitee release continues"
    } else {
        Write-Ok 'pushed github main'
    }
    git push -f github "refs/tags/v${ver}" 2>&1 | Write-Host
    if ($LASTEXITCODE) {
        Write-Warn2 "git push github tag failed (exit $LASTEXITCODE) — Gitee release continues"
    } else {
        Write-Ok "pushed github v$ver"
    }
}
finally { $ErrorActionPreference = $eap }
Write-Ok "pushed origin main + v$ver"

# 8. Publish the Gitee Release + installer.
& "$PSScriptRoot\Publish.ps1" -Version $ver

# 9. Verify the raw version.json URL resolves (302 -> 200) with the right version.
Write-Step 'verify raw version.json'
$u = "https://gitee.com/Andyqwe44/mimic/raw/v$ver/release/GameAgentMonitor/version.json"
try {
    $r = Invoke-RestMethod -Uri $u -Method Get
    if ($r.app -eq $ver) { Write-Ok "raw 200, app=$($r.app)" } else { Write-Warn2 "raw app mismatch: $($r.app)" }
}
catch { Write-Warn2 "raw URL check failed: $_" }

Write-Host "`n==================== release $ver DONE ====================" -ForegroundColor Green
Write-Host "  https://gitee.com/Andyqwe44/mimic/releases/download/v$ver/GameAgentMonitor_Setup_v$ver.exe"
