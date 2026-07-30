@echo off
REM Logexus AI Browser — Native Messaging Host 注册脚本 (Windows)
REM 以管理员身份运行此脚本

set EXTENSION_ID=%1
if "%EXTENSION_ID%"=="" (
  echo 用法: install.bat <扩展ID>
  echo 请在 chrome://extensions 中获取扩展的 32 位 ID
  exit /b 1
)

echo 扩展 ID: %EXTENSION_ID%

REM 获取当前目录的绝对路径
set HOST_DIR=%~dp0
set HOST_PATH=%HOST_DIR%host.bat
set MANIFEST_PATH=%HOST_DIR%com.logexus.browser.host.json

REM 生成 host.bat（启动 Node.js）
echo @echo off > "%HOST_PATH%"
echo node "%HOST_DIR%host.js" >> "%HOST_PATH%"

REM 生成 host manifest JSON
REM 注意：路径中的反斜杠需要转义为双反斜杠
set ESCAPED_PATH=%HOST_PATH:\=\\%
(
echo {
echo   "name": "com.logexus.browser.host",
echo   "description": "Logexus AI Browser Native Messaging Host",
echo   "path": "%ESCAPED_PATH%",
echo   "type": "stdio",
echo   "allowed_origins": ["chrome-extension://%EXTENSION_ID%/"]
echo }
) > "%MANIFEST_PATH%"

REM 写入 Windows 注册表
set REG_KEY=HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.logexus.browser.host
reg add "%REG_KEY%" /ve /d "%MANIFEST_PATH%" /f

if %ERRORLEVEL% EQU 0 (
  echo.
  echo ============================================
  echo   注册成功！
  echo   Host: %HOST_PATH%
  echo   Manifest: %MANIFEST_PATH%
  echo ============================================

  REM 安装 Node.js 依赖
  echo.
  echo 正在安装 Native Host 依赖...
  cd /d "%HOST_DIR%"
  call npm install --production
  if %ERRORLEVEL% EQU 0 (
    echo 依赖安装完成
  ) else (
    echo 依赖安装失败，请检查 Node.js 是否已安装
  )
  echo.
  echo 请重启 Chrome 使配置生效
) else (
  echo 注册表写入失败，请以管理员身份运行
)
