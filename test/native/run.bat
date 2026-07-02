@echo off
REM Native round-trip test for the config engine (host MSVC, no device needed).
REM Compiles test_main.cpp + the engine against the Arduino/Preferences shims and
REM runs it. DEFAULT_TEMPLATE picks the board preset the test asserts against.
REM Usage:  test\native\run.bat
setlocal
set ROOT=%~dp0..\..
pushd "%ROOT%"
if not exist build mkdir build
REM Generate the embedded templates from templates/*.ini (same source the firmware uses)
python tools\gen_config_templates.py "%ROOT%" "%ROOT%\src\generated\config_templates.gen.h"
if errorlevel 1 ( echo template generation failed & popd & exit /b 1 )
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
cl /nologo /EHsc /std:c++17 /I test\native\shim /I lib\EmbeddedConfig\src /I include ^
   /DDEFAULT_TEMPLATE=luxdmx_v4 ^
   test\native\test_main.cpp ^
   lib\EmbeddedConfig\src\config_core.cpp lib\EmbeddedConfig\src\config_serial.cpp ^
   src\config\config_schema.cpp src\config_templates_gen.cpp ^
   /Fe:build\cfgtest.exe /Fobuild\ > build\compile.log 2>&1
if errorlevel 1 ( type build\compile.log & popd & exit /b 1 )
build\cfgtest.exe
set RC=%errorlevel%
popd
exit /b %RC%
