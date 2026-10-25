# =========================================================
#  Universal POS — โปรแกรมที่มุมขวาล่างของจอ (system tray)
#  - เปิดเซิร์ฟเวอร์ POS แบบไม่มีหน้าต่างดำ และเปิดใหม่อัตโนมัติถ้าหยุดทำงาน
#  - เมนู: เปิดหน้าขาย, เปิดโฟลเดอร์ข้อมูล, ตั้งค่าเครือข่าย/การพิมพ์/เปิดพร้อม Windows, ปิดโปรแกรม
# =========================================================
param([switch]$Startup, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

# เปิดได้ครั้งเดียว — ถ้าเปิดอยู่แล้วแค่เปิดหน้าขายขึ้นมา
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\UniversalPOS-Tray', [ref]$created)
if (-not $created) {
  if (-not $NoBrowser) { Open-PosWindow }
  exit
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$node = Get-NodeExe
if (-not $node) {
  [System.Windows.Forms.MessageBox]::Show("ไม่พบโปรแกรม Node.js`n`nกรุณาติดตั้งใหม่ด้วยไฟล์ติดตั้งฉบับเต็ม (UniversalPOS-Setup.zip)", $AppName, 'OK', 'Error') | Out-Null
  exit 1
}

$script:token = [guid]::NewGuid().ToString('N')
$script:server = $null
$script:stopping = $false
$script:restarts = @()

function Start-PosServer {
  $cfg = Get-PosConfig
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $argList = @("`"$AppDir\server.js`"", '--port', $cfg.port, '--data', "`"$DataDir`"", '--log', "`"$LogFile`"")
  if ($cfg.lan) { $argList += '--lan' }
  $psi.Arguments = $argList -join ' '
  $psi.WorkingDirectory = $AppDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['POS_CONTROL_TOKEN'] = $script:token
  $script:server = [System.Diagnostics.Process]::Start($psi)
}

function Stop-PosServer {
  $script:stopping = $true
  if ($script:server -and -not $script:server.HasExited) {
    try {
      Invoke-WebRequest -Uri "$(Get-PosApiUrl)/api/shutdown" -Method Post -Headers @{ 'x-pos-token' = $script:token } -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 3 | Out-Null
    } catch { }
    if (-not $script:server.WaitForExit(5000)) { $script:server.Kill() }
  }
  $script:stopping = $false
}

function Wait-PosServer([int]$seconds = 15) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    if (Test-PosServer) { return $true }
    Start-Sleep -Milliseconds 300
  }
  return $false
}

# ---------- Tray icon & menu ----------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.Icon]::FromHandle((New-PosBitmap 32).GetHicon())
$tray.Text = "$AppName — กำลังทำงาน"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('เปิดหน้าขาย')
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
$miFolder = $menu.Items.Add('เปิดโฟลเดอร์ข้อมูลและไฟล์สำรอง')
$menu.Items.Add('-') | Out-Null
$miLan = New-Object System.Windows.Forms.ToolStripMenuItem 'ให้เครื่องอื่นในร้านเชื่อมต่อได้ (Wi-Fi เดียวกัน)'
$miPrint = New-Object System.Windows.Forms.ToolStripMenuItem 'พิมพ์ใบเสร็จทันทีโดยไม่ต้องกดยืนยัน'
$miStartup = New-Object System.Windows.Forms.ToolStripMenuItem 'เปิดโปรแกรมอัตโนมัติเมื่อเปิดเครื่อง'
$menu.Items.AddRange(@($miLan, $miPrint, $miStartup))
$menu.Items.Add('-') | Out-Null
$miExit = $menu.Items.Add('ปิดโปรแกรม POS')
$tray.ContextMenuStrip = $menu

function Sync-MenuChecks {
  $cfg = Get-PosConfig
  $miLan.Checked = [bool]$cfg.lan
  $miPrint.Checked = [bool]$cfg.silentPrint
  $miStartup.Checked = Test-Path $StartupLink
}
Sync-MenuChecks

$miOpen.add_Click({ Open-PosWindow })
$tray.add_MouseDoubleClick({ Open-PosWindow })
$tray.add_BalloonTipClicked({ Open-PosWindow })
$miFolder.add_Click({ Start-Process explorer.exe -ArgumentList "`"$DataDir`"" })

$miLan.add_Click({
  $cfg = Get-PosConfig
  $cfg.lan = -not [bool]$cfg.lan
  if ($cfg.lan) {
    $ok = [System.Windows.Forms.MessageBox]::Show("เปิดให้แท็บเล็ต/มือถือ/คอมเครื่องอื่นที่ต่อ Wi-Fi เดียวกันใช้ข้อมูลร้านชุดนี้?`n`nใช้เฉพาะเครือข่ายของร้านเท่านั้น อย่าเปิดเมื่อใช้ Wi-Fi สาธารณะหรือ Wi-Fi ที่ให้ลูกค้าใช้`n(Windows อาจถามเรื่อง Firewall ให้กด 'อนุญาต' สำหรับเครือข่ายส่วนตัว)", $AppName, 'YesNo', 'Question')
    if ($ok -ne 'Yes') { return }
  }
  Save-PosConfig $cfg
  Stop-PosServer
  Start-PosServer
  if (Wait-PosServer) {
    if ($cfg.lan) {
      $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not $_.ToString().StartsWith('127.') -and -not $_.ToString().StartsWith('169.254.') }
      $urls = ($ips | ForEach-Object { "http://$($_):$($cfg.port)" }) -join "`n"
      [System.Windows.Forms.MessageBox]::Show("เปิดแล้ว — ให้เครื่องอื่นเปิดเบราว์เซอร์แล้วพิมพ์ที่อยู่นี้:`n`n$urls", $AppName, 'OK', 'Information') | Out-Null
    } else {
      $tray.ShowBalloonTip(3000, $AppName, 'ปิดการเชื่อมต่อจากเครื่องอื่นแล้ว', 'Info')
    }
  }
  Sync-MenuChecks
})

$miPrint.add_Click({
  $cfg = Get-PosConfig
  $cfg.silentPrint = -not [bool]$cfg.silentPrint
  Save-PosConfig $cfg
  Sync-MenuChecks
  $msg = if ($cfg.silentPrint) { "เปิดแล้ว — ใบเสร็จจะพิมพ์ออกเครื่องพิมพ์หลัก (Default printer) ทันที`n`nกรุณา:`n1. ตั้งเครื่องพิมพ์ใบเสร็จเป็นเครื่องพิมพ์หลักของ Windows`n2. ปิดหน้าขายแล้วเปิดใหม่ให้มีผล" } else { 'ปิดแล้ว — ปิดหน้าขายแล้วเปิดใหม่ให้มีผล' }
  [System.Windows.Forms.MessageBox]::Show($msg, $AppName, 'OK', 'Information') | Out-Null
})

$miStartup.add_Click({
  $cfg = Get-PosConfig
  $cfg.startWithWindows = -not (Test-Path $StartupLink)
  Set-StartWithWindows $cfg.startWithWindows
  Save-PosConfig $cfg
  Sync-MenuChecks
})

$miExit.add_Click({
  $ok = [System.Windows.Forms.MessageBox]::Show("ปิดโปรแกรม POS?`n`nหน้าขายและเครื่องอื่นที่เชื่อมต่ออยู่จะบันทึกข้อมูลไม่ได้จนกว่าจะเปิดโปรแกรมอีกครั้ง", $AppName, 'YesNo', 'Warning')
  if ($ok -ne 'Yes') { return }
  $watchdog.Stop()
  Stop-PosServer
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

# ---------- Watchdog: เปิดเซิร์ฟเวอร์ใหม่ถ้าหยุดทำงาน ----------
$watchdog = New-Object System.Windows.Forms.Timer
$watchdog.Interval = 5000
$watchdog.add_Tick({
  if ($script:stopping -or -not $script:server -or -not $script:server.HasExited) { return }
  # พอร์ตถูกใช้โดยโปรแกรม POS อีกตัว (เช่น start-pos.bat) — ใช้ตัวนั้นไปก่อน
  if (Test-PosServer) { return }
  $now = Get-Date
  $script:restarts = @($script:restarts | Where-Object { ($now - $_).TotalMinutes -lt 5 }) + $now
  if ($script:restarts.Count -gt 5) {
    $watchdog.Stop()
    $tray.Text = "$AppName — หยุดทำงาน"
    [System.Windows.Forms.MessageBox]::Show("เซิร์ฟเวอร์ POS หยุดทำงานซ้ำหลายครั้ง`n`nดูรายละเอียดในไฟล์:`n$LogFile", $AppName, 'OK', 'Error') | Out-Null
    return
  }
  Start-PosServer
})

# ---------- Start ----------
Start-PosServer
if (-not (Wait-PosServer)) {
  [System.Windows.Forms.MessageBox]::Show("เปิดเซิร์ฟเวอร์ POS ไม่สำเร็จ`n`nอาจมีโปรแกรมอื่นใช้พอร์ต $((Get-PosConfig).port) อยู่ ดูรายละเอียดในไฟล์:`n$LogFile", $AppName, 'OK', 'Error') | Out-Null
}
$watchdog.Start()
if (-not $NoBrowser) { Open-PosWindow }

$cfg = Get-PosConfig
if (-not $cfg.welcomed) {
  $tray.ShowBalloonTip(8000, $AppName, 'โปรแกรมทำงานอยู่ที่ไอคอนนี้ — ดับเบิลคลิกเพื่อเปิดหน้าขาย คลิกขวาเพื่อดูเมนู', 'Info')
  $cfg.welcomed = $true
  Save-PosConfig $cfg
}

$appContext = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($appContext)
$tray.Dispose()
$mutex.ReleaseMutex()
