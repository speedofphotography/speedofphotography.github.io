@echo off
rem Starts SOP Studio (create and manage client galleries). Keep the window open while you work; close it to lock.
title SOP Studio
where node >nul 2>nul || (echo SOP Studio needs Node.js. Install the LTS version from https://nodejs.org and try again. & pause & exit /b 1)
node "%~dp0studio\studio.mjs"
pause
