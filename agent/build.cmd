@echo off
cd /d "%~dp0"
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
if %ERRORLEVEL% NEQ 0 (echo vcvars failed & exit /b 1)
if not exist "build" mkdir "build"
cl.exe /EHsc /W4 /std:c++17 /I. /Fe:build\agent.exe src\main.cpp src\agent.cpp src\action_mapper.cpp ..\common\signals.cpp ..\capture\src\capture_dxgi.cpp ..\capture\src\preprocess.cpp ..\input\src\input_sendinput.cpp d3d11.lib dxgi.lib user32.lib gdi32.lib ws2_32.lib
if %ERRORLEVEL% EQU 0 (echo Build OK: agent\build\agent.exe)
