#Requires -Version 5.1
<#
.SYNOPSIS
    Download and flash the latest LumiGate firmware to an ESP32.

.DESCRIPTION
    1. Checks for / installs Python 3 via winget
    2. Installs esptool via pip
    3. Downloads the four firmware blobs from the latest GitHub release
    4. Lets you pick a COM port
    5. Flashes the ESP32 (you must put it into boot mode first)
#>

$ErrorActionPreference = "Stop"
$REPO = "tombueng/LumiGate"
$BAUD = 460800
$FLASH_ADDR = @{
    "bootloader.bin"  = "0x1000"
    "partitions.bin"  = "0x8000"
    "boot_app0.bin"   = "0xe000"
    "firmware.bin"    = "0x10000"
}

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# 1. Python
# ---------------------------------------------------------------------------
Write-Step "Checking Python..."
$python = $null
foreach ($cmd in @("python", "python3")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python 3") { $python = $cmd; break }
    } catch {}
}

if (-not $python) {
    Write-Host "    Python 3 not found. Installing via winget..." -ForegroundColor Yellow
    winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $python = "python"
}
Write-Ok (& $python --version)

# ---------------------------------------------------------------------------
# 2. esptool
# ---------------------------------------------------------------------------
Write-Step "Checking esptool..."
$esptoolOk = $false
try {
    $et = & $python -m esptool version 2>&1
    if ($et -match "esptool") { $esptoolOk = $true }
} catch {}

if (-not $esptoolOk) {
    Write-Host "    Installing esptool..." -ForegroundColor Yellow
    & $python -m pip install --quiet esptool
}
Write-Ok "esptool ready"

# ---------------------------------------------------------------------------
# 3. Download firmware blobs
# ---------------------------------------------------------------------------
Write-Step "Fetching latest release from github.com/$REPO ..."
$apiUrl  = "https://api.github.com/repos/$REPO/releases/tags/latest"
$headers = @{ "User-Agent" = "LumiGate-flash-script" }
try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers
} catch {
    Write-Err "Could not reach GitHub API: $_"
}

$tmpDir = Join-Path $env:TEMP "lumigate_flash"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

foreach ($file in $FLASH_ADDR.Keys) {
    $asset = $release.assets | Where-Object { $_.name -eq $file }
    if (-not $asset) { Write-Err "Asset '$file' not found in latest release." }
    $dest = Join-Path $tmpDir $file
    Write-Host "    Downloading $file ..." -NoNewline
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing
    Write-Host " done" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 4. Select COM port
# ---------------------------------------------------------------------------
Write-Step "Available COM ports:"
$ports = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object
if ($ports.Count -eq 0) { Write-Err "No COM ports found. Is the ESP32 connected?" }

for ($i = 0; $i -lt $ports.Count; $i++) {
    Write-Host "    [$i] $($ports[$i])"
}
$idx = Read-Host "`n    Enter number for your ESP32 COM port"
if (-not ($idx -match '^\d+$') -or [int]$idx -ge $ports.Count) {
    Write-Err "Invalid selection."
}
$port = $ports[[int]$idx]
Write-Ok "Selected $port"

# ---------------------------------------------------------------------------
# 5. Boot-mode instructions
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "############################################################" -ForegroundColor Yellow
Write-Host "#   PUT THE ESP32 INTO BOOT MODE NOW                       #" -ForegroundColor Yellow
Write-Host "#                                                           #" -ForegroundColor Yellow
Write-Host "#   1. Hold the BOOT button (GPIO0) on the ESP32           #" -ForegroundColor Yellow
Write-Host "#   2. While holding BOOT, press and release the EN/RST    #" -ForegroundColor Yellow
Write-Host "#      button once                                          #" -ForegroundColor Yellow
Write-Host "#   3. Release BOOT                                         #" -ForegroundColor Yellow
Write-Host "#   The blue LED should now be OFF (boot loader mode)       #" -ForegroundColor Yellow
Write-Host "############################################################" -ForegroundColor Yellow
Write-Host ""
Read-Host "    Press ENTER when the ESP32 is in boot mode"

# ---------------------------------------------------------------------------
# 6. Flash
# ---------------------------------------------------------------------------
Write-Step "Flashing $port at $BAUD baud..."

$args = @(
    "-m", "esptool",
    "--chip",  "esp32",
    "--port",  $port,
    "--baud",  $BAUD,
    "--before", "no_reset",
    "--after",  "hard_reset",
    "write_flash", "-z", "--flash_mode", "dio", "--flash_freq", "80m",
    $FLASH_ADDR["bootloader.bin"],  (Join-Path $tmpDir "bootloader.bin"),
    $FLASH_ADDR["partitions.bin"],  (Join-Path $tmpDir "partitions.bin"),
    $FLASH_ADDR["boot_app0.bin"],   (Join-Path $tmpDir "boot_app0.bin"),
    $FLASH_ADDR["firmware.bin"],    (Join-Path $tmpDir "firmware.bin")
)

& $python @args
if ($LASTEXITCODE -ne 0) { Write-Err "esptool exited with code $LASTEXITCODE" }

Write-Host ""
Write-Host "############################################################" -ForegroundColor Green
Write-Host "#   Flash complete!                                         #" -ForegroundColor Green
Write-Host "#   Press the EN/RST button (or power-cycle) to boot.      #" -ForegroundColor Green
Write-Host "#   First boot opens WiFi AP: DMX-Gateway (no password)    #" -ForegroundColor Green
Write-Host "############################################################" -ForegroundColor Green
