@echo off
cd /d "%~dp0"
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (echo vcvars failed & exit /b 1)

REM Compile .slint -> C++ header
echo Compiling appwindow.slint...
src\slint_bin\bin\slint-compiler.exe src\appwindow.slint -o include\appwindow.h
if %ERRORLEVEL% NEQ 0 (echo Slint compile failed & exit /b 1)

if not exist "build" mkdir "build"

cl.exe /EHsc /std:c++20 /W3 ^
    /I include /I src/slint_bin/include/slint ^
    /I ../capture/include /I ../input/include /I ../common/include /I . ^
    /Fo"build\\" /Fe:monitor.exe ^
    src\main.cpp ^
    ../capture\src\capture_dxgi.cpp ../capture\src\preprocess.cpp ^
    ../input\src\input_sendinput.cpp ^
    ../common\src\signals.cpp ^
    /link src/slint_bin/lib/slint_cpp.dll.lib ^
    d3d11.lib dxgi.lib user32.lib gdi32.lib ws2_32.lib ^
    /SUBSYSTEM:CONSOLE

if %ERRORLEVEL% EQU 0 (
    copy /Y src\slint_bin\lib\slint_cpp.dll . >nul 2>&1
    echo Build OK: monitor\monitor.exe
)
