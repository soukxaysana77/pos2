@echo off
rem Universal POS - double-click to install (no admin rights needed)
chcp 65001 >nul
title Universal POS Setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\install.ps1" %*
if errorlevel 1 pause
