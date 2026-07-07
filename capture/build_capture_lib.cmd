@echo off
cd /d "%~dp0"
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (echo vcvars failed & exit /b 1)
if not exist "build" mkdir "build"

set CFLAGS=/EHsc /std:c++17 /I include /c

rem === Common utilities (validation, window state) ===
cl.exe %CFLAGS% /Fo"build\\capture_common.obj" src\capture_common.cpp || exit /b 1
lib.exe /OUT:build\common.lib build\capture_common.obj || exit /b 1

rem === WGC GPU capture (Direct3D11 + WinRT FramePool) ===
cl.exe %CFLAGS% /Fo"build\\capture_wgc.obj" src\capture_wgc.cpp || exit /b 1
cl.exe %CFLAGS% /Fo"build\\capture_wgc_ffi.obj" src\capture_wgc_ffi.cpp || exit /b 1
lib.exe /OUT:build\wgc.lib build\capture_wgc.obj build\capture_wgc_ffi.obj || exit /b 1

rem === GDI methods (one lib per method) ===
cl.exe %CFLAGS% /Fo"build\\capture_gdi.obj" src\capture_gdi.cpp || exit /b 1
lib.exe /OUT:build\gdi.lib build\capture_gdi.obj || exit /b 1

cl.exe %CFLAGS% /Fo"build\\capture_pw.obj" src\capture_pw.cpp || exit /b 1
lib.exe /OUT:build\pw.lib build\capture_pw.obj || exit /b 1

cl.exe %CFLAGS% /Fo"build\\capture_screen.obj" src\capture_screen.cpp || exit /b 1
lib.exe /OUT:build\screen.lib build\capture_screen.obj || exit /b 1

cl.exe %CFLAGS% /Fo"build\\capture_desktop.obj" src\capture_desktop.cpp || exit /b 1
lib.exe /OUT:build\desktop.lib build\capture_desktop.obj || exit /b 1

echo All capture static libs built OK
