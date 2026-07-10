@echo off
cd /d "%~dp0"
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >NUL 2>&1
echo === Building test_target.exe ===
cl.exe /EHsc /O2 test_target.cpp user32.lib gdi32.lib /Fe:test_target.exe
if %ERRORLEVEL% EQU 0 (
  echo Build OK: test_target.exe
)
