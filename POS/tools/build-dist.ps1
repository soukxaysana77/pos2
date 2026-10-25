# =========================================================
#  สร้างไฟล์ติดตั้งฉบับเต็ม (มี Node.js ในตัว) สำหรับนำไปติดตั้งเครื่องอื่น
#  ผลลัพธ์: dist\UniversalPOS-Setup.zip
#  ใช้งาน: powershell -ExecutionPolicy Bypass -File tools\build-dist.ps1
# =========================================================
param([string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'))

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $OutDir 'UniversalPOS'
$zip = Join-Path $OutDir 'UniversalPOS-Setup.zip'

$node = (Get-Command node -ErrorAction Stop).Source
Write-Host "Node.js: $node ($(& $node --version))"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($d in 'css', 'js', 'launcher') { Copy-Item (Join-Path $root $d) (Join-Path $stage $d) -Recurse }
foreach ($f in 'index.html', 'server.js', 'README.md', 'Install.cmd') { Copy-Item (Join-Path $root $f) (Join-Path $stage $f) }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
Copy-Item $node (Join-Path $stage 'runtime\node.exe')

if (Test-Path $zip) { Remove-Item $zip -Force }
# สร้าง zip เอง: Compress-Archive/ZipFile ของ Windows PowerShell 5.1 ใส่ "\" ในชื่อไฟล์ ทำให้บางโปรแกรมแตกไฟล์ผิด
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$fs = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $entry = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $archive.Dispose(); $fs.Dispose()
}
Write-Host ''
Write-Host "สร้างไฟล์ติดตั้งแล้ว: $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
Write-Host 'นำไฟล์นี้ไปแตกไฟล์ (Extract All) ที่เครื่องปลายทาง แล้วดับเบิลคลิก Install.cmd'
