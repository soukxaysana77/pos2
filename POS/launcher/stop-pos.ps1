# =========================================================
#  Universal POS — ปิดโปรแกรม POS ที่เปิดจาก start-pos.bat (ใช้โดย reset-pos.ps1 / restart-pos.bat)
#  - ปิด node server.js ที่ใช้พอร์ตของ POS และตัวที่เปิดจาก .bat ในโฟลเดอร์นี้ (พอร์ตไหนก็ได้) — ไม่แตะโปรแกรมอื่น
#  - ปิดหน้าต่างดำของตัวเดิมด้วย จะได้ไม่ค้างอยู่หลายหน้าต่าง
#  exit code: 0 = เดิมเปิดเฉพาะเครื่องนี้ (หรือไม่ได้เปิดอยู่) / 2 = เดิมเปิดให้เครื่องอื่นเชื่อมต่อ (--lan) / 1 = ทำต่อไม่ได้
#  ไฟล์นี้ต้องบันทึกเป็น UTF-8 with BOM เพื่อให้ Windows PowerShell 5.1 อ่านภาษาไทยได้
# =========================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$AppDir = Split-Path -Parent $PSScriptRoot

# พอร์ตเดียวกับที่ server.js ใช้: PORT > --port > 8080
$port = 8080
$i = [array]::IndexOf($args, '--port')
if ($i -ge 0 -and $i + 1 -lt $args.Count) { $port = [int]$args[$i + 1] }
if ($env:PORT) { $port = [int]$env:PORT }

$myWindow = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$fromHere = [regex]::Escape($AppDir) + '\\[^\\]*pos[^\\]*\.bat'
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
$wasLan = [bool]($listeners | Where-Object { $_.LocalAddress -notin '127.0.0.1', '::1' })
$targets = @{}

foreach ($procId in @($listeners.OwningProcess | Sort-Object -Unique)) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
  if (-not $p -or $p.Name -ne 'node.exe' -or $p.CommandLine -notmatch 'server\.js') {
    $name = if ($p) { $p.Name } else { "PID $procId" }
    Write-Host "  พอร์ต $port ถูกใช้โดยโปรแกรมอื่น ($name) ซึ่งไม่ใช่ POS จึงไม่ได้ปิดให้" -ForegroundColor Red
    exit 1
  }
  $targets[$p.ProcessId] = $p
}
# POS จากโฟลเดอร์นี้ที่เปิดด้วยพอร์ตอื่น (เช่น start-pos.bat --port 9000)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' } | ForEach-Object {
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)" -ErrorAction SilentlyContinue
  if ($parent -and $parent.CommandLine -match $fromHere) { $targets[$_.ProcessId] = $_ }
}
if (-not $targets.Count) {
  Write-Host '  • ไม่มีโปรแกรม POS เปิดอยู่'
  exit 0
}

foreach ($p in $targets.Values) {
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
  if ($parent -and $parent.CommandLine -match 'tray\.ps1') {
    Write-Host '  โปรแกรม POS ที่ติดตั้งไว้ (ไอคอนมุมขวาล่างของจอ) กำลังทำงานอยู่' -ForegroundColor Yellow
    Write-Host '  ให้คลิกขวาที่ไอคอน → ปิดโปรแกรม POS ก่อน แล้วลองอีกครั้ง' -ForegroundColor Yellow
    exit 1
  }
  if ($p.CommandLine -match '--lan') { $wasLan = $true }
}

foreach ($p in $targets.Values) {
  Write-Host "  • ปิดโปรแกรม POS ตัวเดิม (PID $($p.ProcessId))"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
  $w = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
  if ($w -and $w.Name -eq 'cmd.exe' -and $w.ProcessId -ne $myWindow -and $w.CommandLine -match 'pos[^\\]*\.bat') {
    Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

# รอให้พอร์ตว่างก่อนเปิดตัวใหม่
$until = (Get-Date).AddSeconds(10)
while (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
  if ((Get-Date) -gt $until) {
    Write-Host "  ปิดโปรแกรมเดิมไม่สำเร็จ — พอร์ต $port ยังถูกใช้อยู่" -ForegroundColor Red
    exit 1
  }
  Start-Sleep -Milliseconds 200
}

if ($wasLan) { exit 2 }
exit 0
