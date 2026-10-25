# =========================================================
#  Universal POS — เริ่มต้นใหม่ทุกอย่าง (ใช้โดย restart-pos.bat)
#  1) ถามยืนยัน  2) ปิดโปรแกรม POS ที่เปิดอยู่  3) ย้ายข้อมูลร้านเดิมไปเก็บที่ data\reset-backup-วันที่เวลา (ไม่ได้ลบ)
#  4) สร้างไฟล์ข้อมูลว่างพร้อมรหัสชุดข้อมูลใหม่ → ทุกเบราว์เซอร์/แท็บเล็ตจะล้างสำเนาร้านเดิมของตัวเองเมื่อเชื่อมต่อ
#  exit code: 0 = เสร็จ เปิดแบบเครื่องนี้เครื่องเดียว / 2 = เสร็จ เดิมเปิดให้เครื่องอื่นเชื่อมต่อ / 1 = ยกเลิกหรือทำไม่สำเร็จ
#  ไฟล์นี้ต้องบันทึกเป็น UTF-8 with BOM เพื่อให้ Windows PowerShell 5.1 อ่านภาษาไทยได้
# =========================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$AppDir = Split-Path -Parent $PSScriptRoot
$cli = $args

# โฟลเดอร์ข้อมูลเดียวกับที่ server.js ใช้: --data > POS_DATA_DIR > data ข้างโปรแกรม
$dataDir = Join-Path $AppDir 'data'
if ($env:POS_DATA_DIR) { $dataDir = $env:POS_DATA_DIR }
$i = [array]::IndexOf($cli, '--data')
if ($i -ge 0 -and $i + 1 -lt $cli.Count) { $dataDir = $cli[$i + 1] }
$dataDir = [System.IO.Path]::GetFullPath($dataDir)
$archive = Join-Path $dataDir ('reset-backup-' + (Get-Date -Format 'yyyy-MM-dd_HHmmss'))

Write-Host ''
Write-Host '  ⚠  เริ่มต้นใหม่ทุกอย่าง' -ForegroundColor Yellow
Write-Host ''
Write-Host '  ข้อมูลร้านทั้งหมดจะถูกล้าง: สินค้า สต็อก บิลขาย ลูกค้า กะ ห้อง/โต๊ะ การจอง งานรับ และการตั้งค่าร้าน'
Write-Host '  ทุกเครื่องที่เชื่อมต่ออยู่ (แท็บเล็ต/มือถือ) จะล้างข้อมูลร้านเดิมด้วย'
Write-Host '  แล้วโปรแกรมจะเปิดขึ้นมาใหม่พร้อมตัวช่วยตั้งค่าร้าน เหมือนเพิ่งติดตั้ง'
Write-Host ''
Write-Host '  ข้อมูลเดิมไม่ได้ถูกลบทิ้ง — จะย้ายไปเก็บไว้ที่:'
Write-Host "    $archive"
Write-Host ''
$answer = Read-Host '  พิมพ์คำว่า reset แล้วกด Enter เพื่อยืนยัน (กด Enter เฉย ๆ = ยกเลิก)'
if ("$answer".Trim() -ne 'reset') {
  Write-Host ''
  Write-Host '  ยกเลิกแล้ว — ไม่มีอะไรถูกเปลี่ยน'
  exit 1
}
Write-Host ''

# ต้องปิดโปรแกรมก่อน ไม่อย่างนั้นโปรแกรมที่เปิดค้างจะเขียนข้อมูลร้านเดิมกลับลงไฟล์
& (Join-Path $PSScriptRoot 'stop-pos.ps1') @cli
$mode = $LASTEXITCODE
if ($mode -eq 1) {
  Write-Host '  ยังไม่ได้เปลี่ยนแปลงข้อมูลใด ๆ' -ForegroundColor Yellow
  exit 1
}

try {
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  $old = @(Get-ChildItem -LiteralPath $dataDir -Force | Where-Object { $_.Name -notlike 'reset-backup-*' })
  if ($old.Count) {
    Write-Host '  • ย้ายข้อมูลร้านเดิมไปเก็บ'
    New-Item -ItemType Directory -Path $archive | Out-Null
    $old | Move-Item -Destination $archive
  }
  Write-Host '  • สร้างร้านใหม่'
  $fresh = [ordered]@{
    rev = 0; savedAt = $null; recent = @(); data = $null
    dataId = [guid]::NewGuid().ToString(); resetAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  # UTF-8 แบบไม่มี BOM — server.js อ่านไฟล์ที่มี BOM ไม่ได้
  [System.IO.File]::WriteAllText((Join-Path $dataDir 'pos-data.json'), ($fresh | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding $false))
} catch {
  Write-Host ''
  Write-Host "  เริ่มต้นใหม่ไม่สำเร็จ: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '  (อาจมีไฟล์ในโฟลเดอร์ data เปิดค้างอยู่ในโปรแกรมอื่น — ปิดแล้วลองอีกครั้ง)' -ForegroundColor Red
  Write-Host "  ไฟล์ที่ย้ายไปแล้วอยู่ที่ $archive"
  exit 1
}

Write-Host ''
Write-Host '  ✅ เริ่มต้นใหม่เรียบร้อย — กำลังเปิดโปรแกรม...' -ForegroundColor Green
Write-Host ''
exit $mode
