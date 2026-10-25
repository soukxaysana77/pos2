# =========================================================
#  Universal POS — ถอนการติดตั้ง
#  ลบโปรแกรมและทางลัด — ข้อมูลร้านจะถูกเก็บไว้ เว้นแต่ผู้ใช้เลือกให้ลบ
# =========================================================
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$InstallDir = $AppDir

$ok = [System.Windows.Forms.MessageBox]::Show("ถอนการติดตั้ง $AppName ?", $AppName, 'YesNo', 'Question')
if ($ok -ne 'Yes') { exit }

$deleteData = [System.Windows.Forms.MessageBox]::Show("ลบข้อมูลร้าน (สินค้า ยอดขาย ลูกค้า และไฟล์สำรอง) ด้วยหรือไม่?`n`nแนะนำให้กด 'No' เพื่อเก็บข้อมูลไว้ ถ้าติดตั้งใหม่ภายหลังข้อมูลจะกลับมาเหมือนเดิม`n`nข้อมูลอยู่ที่: $DataDir", $AppName, 'YesNo', 'Warning', 'Button2')

try {
  Stop-PosProcesses $InstallDir
  foreach ($link in @(
      (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"),
      (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"),
      $StartupLink)) {
    if (Test-Path $link) { Remove-Item $link -Force }
  }
  Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\UniversalPOS' -Recurse -Force -ErrorAction SilentlyContinue
  Set-Location $env:TEMP
  if ($deleteData -eq 'Yes') { Remove-Item $PosHome -Recurse -Force -ErrorAction SilentlyContinue }
  else { Remove-Item $BrowserProfile -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  $msg = if ($deleteData -eq 'Yes') { "ถอนการติดตั้งเรียบร้อย" } else { "ถอนการติดตั้งเรียบร้อย`n`nข้อมูลร้านยังเก็บอยู่ที่:`n$DataDir" }
  [System.Windows.Forms.MessageBox]::Show($msg, $AppName, 'OK', 'Information') | Out-Null
} catch {
  [System.Windows.Forms.MessageBox]::Show("ถอนการติดตั้งไม่สำเร็จ:`n$($_.Exception.Message)", $AppName, 'OK', 'Error') | Out-Null
}
