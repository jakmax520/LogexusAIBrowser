@echo off
REM Logexus AI Browser — 注册自动启动
REM Native Host 会在用户登录时自动在后台启动（无窗口）

set VBS_PATH=%~dp0start-silent.vbs
set REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run
set REG_VALUE=LogexusNativeHost

echo 正在注册自动启动...
echo VBS 脚本: %VBS_PATH%

reg add "%REG_KEY%" /v "%REG_VALUE%" /d "\"%VBS_PATH%\"" /f

if %ERRORLEVEL% EQU 0 (
  echo.
  echo ============================================
  echo   自动启动注册成功！
  echo   Native Host 将在下次登录时自动启动
  echo ============================================
  echo.
  echo 现在立即启动 Native Host...
  start "" "%VBS_PATH%"
  echo 已启动！
) else (
  echo 注册失败，请以管理员身份运行
)
