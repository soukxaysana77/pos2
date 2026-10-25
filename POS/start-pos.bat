@echo off
chcp 65001 >nul
title Universal POS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ไม่พบ Node.js ในเครื่องนี้
  echo  กรุณาดาวน์โหลดและติดตั้งจาก https://nodejs.org ^(เลือกรุ่น LTS^) แล้วเปิดไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)
node server.js --open %*
pause
