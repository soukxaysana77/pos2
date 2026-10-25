# =========================================================
#  Universal POS — ค่าและฟังก์ชันที่ใช้ร่วมกัน (tray / install / uninstall)
#  ไฟล์นี้ต้องบันทึกเป็น UTF-8 with BOM เพื่อให้ Windows PowerShell 5.1 อ่านภาษาไทยได้
# =========================================================

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$AppName = 'Universal POS'
$AppDir = Split-Path -Parent $PSScriptRoot
$PosHome = if ($env:UNIVERSALPOS_HOME) { $env:UNIVERSALPOS_HOME } else { Join-Path $env:LOCALAPPDATA 'UniversalPOS' }
$DataDir = Join-Path $PosHome 'data'
$ConfigPath = Join-Path $PosHome 'config.json'
$BrowserProfile = Join-Path $PosHome 'browser'
$LogFile = Join-Path $PosHome 'server.log'
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) "$AppName.lnk"

function Get-NodeExe {
  $bundled = Join-Path $AppDir 'runtime\node.exe'
  if (Test-Path $bundled) { return $bundled }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-PosConfig {
  $cfg = [ordered]@{ port = 8080; lan = $false; silentPrint = $false; startWithWindows = $true; welcomed = $false }
  if (Test-Path $ConfigPath) {
    try {
      $saved = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($p in $saved.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
    } catch { }
  }
  return $cfg
}

function Save-PosConfig($cfg) {
  New-Item -ItemType Directory -Force -Path $PosHome | Out-Null
  ($cfg | ConvertTo-Json) | Set-Content -Path $ConfigPath -Encoding UTF8
}

function Get-PosUrl { param($cfg = (Get-PosConfig)) return "http://localhost:$($cfg.port)" }
# ใช้ 127.0.0.1 สำหรับคำสั่งจากสคริปต์ — "localhost" ลอง IPv6 ก่อนทำให้ช้าไป ~2 วินาที
function Get-PosApiUrl { param($cfg = (Get-PosConfig)) return "http://127.0.0.1:$($cfg.port)" }

function Find-Browser {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

# เปิดหน้าขายเป็นหน้าต่างโปรแกรม (ไม่มีแถบที่อยู่เว็บ) ด้วย Edge/Chrome
function Open-PosWindow {
  $cfg = Get-PosConfig
  $url = Get-PosUrl $cfg
  $browser = Find-Browser
  if ($browser) {
    $args = @("--app=$url", "--user-data-dir=`"$BrowserProfile`"", '--no-first-run', '--no-default-browser-check', '--start-maximized')
    if ($cfg.silentPrint) { $args += '--kiosk-printing' }
    Start-Process -FilePath $browser -ArgumentList $args
  } else {
    Start-Process $url
  }
}

# ไอคอนโปรแกรม: สี่เหลี่ยมมุมมนไล่สีเขียวอมฟ้า ตัว U สีขาว
function New-PosBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [single]($size * 0.22)
  $d = $r * 2
  $w = [single]($size - 1)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($w - $d, 0, $d, $d, 270, 90)
  $path.AddArc($w - $d, $w - $d, $d, $d, 0, 90)
  $path.AddArc(0, $w - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(20, 184, 166), [System.Drawing.Color]::FromArgb(14, 165, 233), [single]45)
  $g.FillPath($brush, $path)
  $font = New-Object System.Drawing.Font('Segoe UI', [single]($size * 0.6), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF 0, ([single]($size * 0.03)), $size, $size
  $g.DrawString('U', $font, [System.Drawing.Brushes]::White, $textRect, $sf)
  $g.Dispose(); $brush.Dispose(); $font.Dispose(); $path.Dispose()
  return $bmp
}

# บันทึกไฟล์ .ico (เก็บภาพ PNG หลายขนาดไว้ในไฟล์เดียว)
function Save-PosIcon([string]$file) {
  $sizes = 16, 24, 32, 48, 64, 256
  $images = foreach ($s in $sizes) {
    $bmp = New-PosBitmap $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    , $ms.ToArray()
  }
  $out = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $out
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$images[$i].Length); $bw.Write([uint32]$offset)
    $offset += $images[$i].Length
  }
  foreach ($img in $images) { $bw.Write($img) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($file, $out.ToArray())
  $bw.Dispose()
}

# สร้างทางลัดที่เปิดโปรแกรมแบบไม่มีหน้าต่างดำ
function New-PosShortcut([string]$linkPath, [string]$extraArgs = '') {
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut($linkPath)
  $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AppDir\launcher\tray.ps1`" $extraArgs".Trim()
  $s.WorkingDirectory = $AppDir
  $s.IconLocation = "$AppDir\app.ico,0"
  $s.WindowStyle = 7
  $s.Description = $AppName
  $s.Save()
}

function Set-StartWithWindows([bool]$enabled) {
  if ($enabled) { New-PosShortcut $StartupLink '-Startup' }
  elseif (Test-Path $StartupLink) { Remove-Item $StartupLink -Force }
}

function Test-PosServer {
  param($cfg = (Get-PosConfig))
  try {
    $r = Invoke-WebRequest -Uri "$(Get-PosApiUrl $cfg)/api/rev" -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch { return $false }
}

# หยุดโปรแกรม POS ที่ทำงานจากโฟลเดอร์นี้ (ใช้ตอนติดตั้งทับ/ถอนการติดตั้ง)
function Stop-PosProcesses([string]$dir = $AppDir) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like "*$dir\launcher\tray.ps1*" -or $_.CommandLine -like "*$dir\server.js*") }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($procs) { Start-Sleep -Milliseconds 800 }
}
