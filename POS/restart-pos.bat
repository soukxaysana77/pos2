@echo off
chcp 65001 >nul
rem เริ่มต้นใหม่ทุกอย่าง: ล้างข้อมูลร้านทั้งหมด แล้วเปิดโปรแกรมใหม่พร้อมตัวช่วยตั้งค่าร้าน เหมือนเพิ่งติดตั้ง
rem ข้อมูลเดิมไม่ได้ถูกลบ — ย้ายไปเก็บที่ data\reset-backup-วันที่เวลา (ลบโฟลเดอร์นั้นเองได้ถ้าไม่ต้องการแล้ว)
rem ถ้าเดิมเปิดแบบให้เครื่องอื่นเชื่อมต่อ (start-pos-lan.bat) จะเปิดใหม่แบบเดิมให้
title Universal POS - เริ่มต้นใหม่
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\reset-pos.ps1" %*
set "POS_MODE="
if errorlevel 2 (
  set "POS_MODE=--lan"
) else if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
call "%~dp0start-pos.bat" %POS_MODE% %*
