@echo off
REM Host unit test for the on-unit controls logic (issue #24): the pure headers
REM src/enc_decode.h, src/input_map.h, src/menu.h. No device needed.
REM Usage:  test\native\run_controls.bat
setlocal
set ROOT=%~dp0..\..
pushd "%ROOT%"
if not exist build mkdir build
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cl /nologo /EHsc /std:c++17 /I src ^
   test\native\controls_test.cpp ^
   /Fe:build\ctltest.exe /Fobuild\ > build\ctl_compile.log 2>&1
if errorlevel 1 ( type build\ctl_compile.log & popd & exit /b 1 )
build\ctltest.exe
set RC=%errorlevel%
popd
exit /b %RC%
