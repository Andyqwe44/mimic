@echo off
cd /d "%~dp0"
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (echo vcvars failed & exit /b 1)

REM Compile .slint -> C++ header (first time only)
if not exist src\appwindow.h (
    echo Compiling appwindow.slint...
    src\slint_bin\bin\slint-compiler.exe src\appwindow.slint -o src\appwindow.h
    if %ERRORLEVEL% NEQ 0 (echo Slint compile failed & exit /b 1)
)

if not exist "build" mkdir "build"
cl.exe /EHsc /std:c++20 /W3 /I src/slint_bin/include/slint /Fe:build\monitor.exe src\main.cpp /link src/slint_bin/lib/slint_cpp.dll.lib user32.lib shell32.lib /SUBSYSTEM:CONSOLE
if %ERRORLEVEL% EQU 0 (
    copy /Y src\slint_bin\lib\slint_cpp.dll build\ >nul 2>&1
    echo Build OK: monitor\build\monitor.exe
)
