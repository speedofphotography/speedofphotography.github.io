# Installs SOP Studio on this computer, with shortcuts on the Desktop and in the Start menu.
# Run it again any time to update the installed copy. Your saved keys and passphrase are kept
# (they live separately, in %APPDATA%\SOP Studio).
# Run: right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File install-studio.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
$dest = Join-Path $env:LOCALAPPDATA "Programs\SOP Studio"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "SOP Studio needs Node.js. Install the LTS version from https://nodejs.org, then run this again."
  exit 1
}

New-Item -ItemType Directory -Force -Path (Join-Path $dest "lib") | Out-Null
Get-ChildItem (Join-Path $here "studio") -File -Include *.mjs, *.js, *.html, *.css -Recurse | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $dest $_.Name) -Force
}
Copy-Item (Join-Path $repo "_functions_lib\delivery.js") (Join-Path $dest "lib\delivery.js") -Force
Copy-Item (Join-Path $repo "images\logo-small.png") (Join-Path $dest "logo.png") -Force
Copy-Item (Join-Path $repo "favicon.ico") (Join-Path $dest "studio.ico") -Force
[IO.File]::WriteAllText((Join-Path $dest "package.json"), "{ `"type`": `"module`" }`n")
[IO.File]::WriteAllText((Join-Path $dest "SOP Studio.cmd"), (@(
  "@echo off",
  "title SOP Studio",
  "where node >nul 2>nul || (echo SOP Studio needs Node.js. Install the LTS version from https://nodejs.org and try again. & pause & exit /b 1)",
  "node `"%~dp0studio.mjs`"",
  "pause"
) -join "`r`n") + "`r`n")

$shell = New-Object -ComObject WScript.Shell
$startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "SOP Studio.lnk"
$desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "SOP Studio.lnk"
foreach ($lnk in $desktop, $startMenu) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $dest "SOP Studio.cmd"
  $s.WorkingDirectory = $dest
  $s.IconLocation = (Join-Path $dest "studio.ico") + ",0"
  $s.Description = "Make and manage client galleries"
  $s.WindowStyle = 7 # start the window minimized; the app opens in your browser
  $s.Save()
}

Write-Host ""
Write-Host "SOP Studio is installed in $dest"
Write-Host "Open it from the SOP Studio icon on your Desktop or in the Start menu."
