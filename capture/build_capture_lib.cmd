@echo off
cd /d "%~dp0"
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (echo vcvars failed & exit /b 1)
if not exist "build" mkdir "build"

set CFLAGS=/EHsc /std:c++17 /I include /c

rem === Common utilities (validation, window state) ===
cl.exe %CFLAGS% /Fo"build\\capture_common.obj" src\capture_common.cpp || exit /b 1

rem === Individual capture methods ===
cl.exe %CFLAGS% /Fo"build\\capture_gdi.obj" src\capture_gdi.cpp || exit /b 1
cl.exe %CFLAGS% /Fo"build\\capture_pw.obj" src\capture_pw.cpp || exit /b 1
cl.exe %CFLAGS% /Fo"build\\capture_screen.obj" src\capture_screen.cpp || exit /b 1
cl.exe %CFLAGS% /Fo"build\\capture_desktop.obj" src\capture_desktop.cpp || exit /b 1
cl.exe %CFLAGS% /Fo"build\\capture_auto.obj" src\capture_auto.cpp || exit /b 1

rem === WGC GPU capture (Direct3D11 + WinRT FramePool) ===
cl.exe %CFLAGS% /Fo"build\\capture_wgc.obj" src\capture_wgc.cpp || exit /b 1
cl.exe %CFLAGS% /Fo"build\\capture_wgc_ffi.obj" src\capture_wgc_ffi.cpp || exit /b 1

rem === Package into static library ===
lib.exe /OUT:build\capture_lib.lib ^
  build\capture_common.obj ^
  build\capture_gdi.obj ^
  build\capture_pw.obj ^
  build\capture_screen.obj ^
  build\capture_desktop.obj ^
  build\capture_auto.obj ^
  build\capture_wgc.obj ^
  build\capture_wgc_ffi.obj
if %ERRORLEVEL% NEQ 0 (echo lib FAILED & exit /b 1)

echo Capture static lib built OK (%ERRORLEVEL%)
