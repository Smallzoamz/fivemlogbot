@echo off
title FiveM Admin System Runner
echo ========================================================
echo        FiveM Admin Log Search and Ticket Bot System
echo ========================================================
echo.
echo [1/2] Installing dependencies in all subfolders...
call npm install
call npm run install:all
echo.
echo [2/2] Starting Desktop Application Console...
echo.
call npm start
echo.
echo ========================================================
echo [SUCCESS] All systems started successfully!
echo - Backend API running at: http://localhost:5000
echo - Web Dashboard running at: http://localhost:5173
echo ========================================================
echo.
pause
