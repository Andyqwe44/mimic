@echo off
cd /d "%~dp0"
set "TEST_DIR=%~dp0"
set "CAPTURE_DIR=%TEST_DIR%..\capture"

call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (echo vcvars failed & exit /b 1)

if not exist "build" mkdir "build"

echo === Building WGC Capture Benchmark ===
cl.exe /EHsc /std:c++17 /I "%CAPTURE_DIR%\include" /Fo"build\\" /Fe:build\wgc_bench_capture.exe ^
  wgc_bench_capture.cpp "%CAPTURE_DIR%\..\logger\logger.cpp" "%CAPTURE_DIR%\src\capture_wgc.cpp" ^
  d3d11.lib dxgi.lib user32.lib gdi32.lib windowsapp.lib

if %ERRORLEVEL% EQU 0 (
  echo Build OK: test\build\wgc_bench_capture.exe
  echo.
  echo Usage: build\wgc_bench_capture.exe 0 --monitor --duration 5 --poll
  echo        build\wgc_bench_capture.exe 0 --monitor --duration 5       ^(CV wait mode^)
)
