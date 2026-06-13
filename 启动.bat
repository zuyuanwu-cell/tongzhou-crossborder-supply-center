@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动同舟供应链中心...
npm run dev:all
pause
