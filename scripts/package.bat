@echo off
REM Logexus AI Browser — Production packaging script
echo === Logexus AI Browser — Production Build & Package ===

REM 1. Clean
echo [1/4] Cleaning...
if exist dist rmdir /s /q dist
if exist logexus-ai-browser-v*.zip del logexus-ai-browser-v*.zip

REM 2. Build
echo [2/4] Building...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo BUILD FAILED
  exit /b 1
)

REM 3. Get version
for /f "tokens=2 delims=:," %%a in ('findstr "version" manifest.json ^| findstr /v "manifest_version"') do (
  set VER=%%a
)
set VER=%VER:"=%
set VER=%VER: =%

REM 4. Package
echo [3/4] Packaging v%VER%...
powershell Compress-Archive -Path "dist\*" -DestinationPath "logexus-ai-browser-v%VER%.zip" -Force

echo [4/4] Done!
echo.
echo Package: logexus-ai-browser-v%VER%.zip
echo File size:
powershell (Get-Item "logexus-ai-browser-v%VER%.zip").Length / 1024
echo KB
echo.
echo Ready for Chrome Web Store submission.
