# =========================================================
#  Universal POS — ตัวติดตั้ง (ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ)
#  - คัดลอกโปรแกรมไปที่ %LOCALAPPDATA%\Programs\UniversalPOS
#  - ข้อมูลร้านเก็บที่ %LOCALAPPDATA%\UniversalPOS\data (ติดตั้งทับ/อัปเดตไม่กระทบข้อมูล)
#  - สร้างไอคอนบนเดสก์ท็อป, เมนู Start, เปิดพร้อม Windows และรายการใน "แอปที่ติดตั้ง"
# =========================================================
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\UniversalPOS'),
  [switch]$NoIntegration,   # ไม่สร้างทางลัด/รีจิสทรี (ใช้ทดสอบ)
  [switch]$NoLaunch,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$SourceDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')

function Show-Message($text, $icon = 'Information') {
  if (-not $Quiet) { [System.Windows.Forms.MessageBox]::Show($text, "ติดตั้ง $AppName", 'OK', $icon) | Out-Null }
}
function Step($text) { Write-Host "  • $text" }

try {
  Write-Host ''
  Write-Host "  กำลังติดตั้ง $AppName ..."
  Write-Host ''

  # 1) หา Node.js (ฉบับเต็มมี runtime\node.exe มาในไฟล์ติดตั้ง)
  $node = Join-Path $SourceDir 'runtime\node.exe'
  if (-not (Test-Path $node)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) {
      Show-Message "ไม่พบ Node.js ในเครื่องนี้`n`nกรุณาใช้ไฟล์ติดตั้งฉบับเต็ม (UniversalPOS-Setup.zip) ซึ่งมีทุกอย่างในตัว`nหรือติดตั้ง Node.js จาก https://nodejs.org แล้วลองอีกครั้ง" 'Error'
      exit 1
    }
    $node = $cmd.Source
  }

  # 2) ปิดโปรแกรมเดิมถ้ากำลังทำงาน (กรณีติดตั้งทับ/อัปเดต)
  $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
  Step 'ปิดโปรแกรมเดิม (ถ้ามี)'
  Stop-PosProcesses $InstallDir
  # โปรแกรม POS แบบเก่า (หน้าต่างดำจาก start-pos.bat) ใช้พอร์ตเดียวกัน — ต้องปิดก่อนเพื่อย้ายข้อมูลล่าสุด
  while (Test-PosServer) {
    if ($Quiet) { throw "พอร์ต $((Get-PosConfig).port) ถูกใช้งานอยู่" }
    $r = [System.Windows.Forms.MessageBox]::Show("พบโปรแกรม POS เปิดอยู่ (เช่น หน้าต่างดำจาก start-pos.bat)`n`nกรุณาปิดหน้าต่างนั้นก่อน แล้วกด Retry", "ติดตั้ง $AppName", 'RetryCancel', 'Warning')
    if ($r -ne 'Retry') { exit 1 }
  }

  # 3) คัดลอกไฟล์โปรแกรม
  Step "คัดลอกโปรแกรมไปที่ $InstallDir"
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $sameDir = ([System.IO.Path]::GetFullPath($SourceDir).TrimEnd('\') -ieq $InstallDir.TrimEnd('\'))
  if (-not $sameDir) {
    foreach ($d in 'css', 'js', 'launcher') {
      $target = Join-Path $InstallDir $d
      if (Test-Path $target) { Remove-Item $target -Recurse -Force }
      Copy-Item (Join-Path $SourceDir $d) $target -Recurse -Force
    }
    foreach ($f in 'index.html', 'server.js', 'README.md') {
      $src = Join-Path $SourceDir $f
      if (Test-Path $src) { Copy-Item $src (Join-Path $InstallDir $f) -Force }
    }
  }
  $runtimeDir = Join-Path $InstallDir 'runtime'
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $targetNode = Join-Path $runtimeDir 'node.exe'
  if ([System.IO.Path]::GetFullPath($node) -ine [System.IO.Path]::GetFullPath($targetNode)) {
    Step 'คัดลอก Node.js runtime'
    Copy-Item $node $targetNode -Force
  }

  # 4) ย้ายข้อมูลร้านเดิมจากโฟลเดอร์ data ที่อยู่ข้างไฟล์ติดตั้ง (เคยใช้ start-pos.bat)
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $oldData = Join-Path $SourceDir 'data\pos-data.json'
  $newData = Join-Path $DataDir 'pos-data.json'
  if ((Test-Path $oldData) -and -not (Test-Path $newData)) {
    Step 'ย้ายข้อมูลร้านเดิมมาไว้ที่โฟลเดอร์ข้อมูลใหม่'
    Copy-Item (Join-Path $SourceDir 'data\*') $DataDir -Recurse -Force
  }

  # 5) ไอคอนและการตั้งค่า
  Step 'สร้างไอคอนโปรแกรม'
  Save-PosIcon (Join-Path $InstallDir 'app.ico')
  $cfg = Get-PosConfig
  Save-PosConfig $cfg

  # 6) ทางลัดและการผูกกับ Windows (ต้องอ้างถึงโฟลเดอร์ที่ติดตั้ง)
  if (-not $NoIntegration) {
    . (Join-Path $InstallDir 'launcher\common.ps1')
    Step 'สร้างไอคอนบนเดสก์ท็อปและเมนู Start'
    New-PosShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk")
    New-PosShortcut (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk")
    if ($cfg.startWithWindows) { Step 'ตั้งให้เปิดอัตโนมัติเมื่อเปิดเครื่อง'; Set-StartWithWindows $true }

    Step 'ลงทะเบียนใน "แอปที่ติดตั้ง" ของ Windows'
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\UniversalPOS'
    New-Item -Path $key -Force | Out-Null
    $version = '1.2.0'
    $props = @{
      DisplayName     = $AppName
      DisplayVersion  = $version
      Publisher       = $AppName
      DisplayIcon     = "$InstallDir\app.ico"
      InstallLocation = $InstallDir
      UninstallString = "`"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\launcher\uninstall.ps1`""
    }
    foreach ($k in $props.Keys) { Set-ItemProperty -Path $key -Name $k -Value $props[$k] }
    Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
    Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord
    Set-ItemProperty -Path $key -Name EstimatedSize -Value ([int]((Get-ChildItem $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)) -Type DWord
  }

  Write-Host ''
  Write-Host '  ✅ ติดตั้งเสร็จแล้ว'
  if (-not $NoLaunch) {
    Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\launcher\tray.ps1`""
  }
  Show-Message "ติดตั้ง $AppName เรียบร้อยแล้ว ✅`n`n• เปิดโปรแกรมได้จากไอคอน '$AppName' บนเดสก์ท็อป`n• โปรแกรมทำงานอยู่ที่ไอคอนมุมขวาล่างของจอ (ข้างนาฬิกา) คลิกขวาเพื่อดูเมนู`n• ข้อมูลร้านบันทึกอัตโนมัติที่:`n  $DataDir"
} catch {
  Write-Host $_ -ForegroundColor Red
  Show-Message "ติดตั้งไม่สำเร็จ:`n`n$($_.Exception.Message)" 'Error'
  exit 1
}
