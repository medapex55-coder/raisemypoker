# Spotwise - PokerStars gateway helper.
# Copies the PokerStars hand histories and tournament summaries of every account
# (%LOCALAPPDATA%\PokerStars.FR\HandHistory\<name> and ...\TournSummary\<name>)
# into Documents\Spotwise\PokerStars, a folder Chrome and Edge are allowed to open.
# Spotwise then reads that folder by itself (My Data > PokerStars gateway).
#
#   Copy once:                     powershell -ExecutionPolicy Bypass -File spotwise-pokerstars-sync.ps1
#   Copy every 10 minutes:         ... -File spotwise-pokerstars-sync.ps1 -Install
#   Stop the automatic copy:       ... -File spotwise-pokerstars-sync.ps1 -Uninstall
#
# Another PokerStars client (.COM, .ES...) : add -Source "<its folder in %LOCALAPPDATA%>".
# It only reads PokerStars's folder and only writes inside Documents\Spotwise.
param(
  [string]$Source = (Join-Path $env:LOCALAPPDATA 'PokerStars.FR'),
  [string]$Dest = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Spotwise\PokerStars'),
  [switch]$Install,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Spotwise PokerStars sync'

if ($Uninstall) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  Write-Output "Automatic copy stopped."
  return
}

if ($Install) {
  # Keep a copy of this script next to the files so the task never points to Downloads.
  $root = Split-Path $Dest -Parent
  New-Item -ItemType Directory -Force $root | Out-Null
  $self = Join-Path $root 'spotwise-pokerstars-sync.ps1'
  if ($PSCommandPath -ne $self) { Copy-Item $PSCommandPath $self -Force }
  $cmd = "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$self`""
  schtasks /Create /SC MINUTE /MO 10 /TN $TaskName /TR $cmd /F | Out-Null
  Write-Output "Automatic copy every 10 minutes is on (task '$TaskName')."
}

if (-not (Test-Path -LiteralPath $Source)) {
  Write-Output "PokerStars folder not found: $Source"
  return
}
New-Item -ItemType Directory -Force $Dest | Out-Null
$copied = 0
foreach ($kind in 'HandHistory', 'TournSummary') {
  $folder = Join-Path $Source $kind
  if (-not (Test-Path -LiteralPath $folder)) { continue }
  foreach ($account in Get-ChildItem -LiteralPath $folder -Directory) {
    foreach ($file in Get-ChildItem -LiteralPath $account.FullName -Filter *.txt -File -Recurse) {
      # Prefix with the account name so two accounts never overwrite each other
      # (hand files start with HH, summaries with TS).
      $target = Join-Path $Dest ($account.Name + '_' + $file.Name)
      $old = Get-Item -LiteralPath $target -ErrorAction SilentlyContinue
      if (-not $old -or $old.Length -ne $file.Length -or $old.LastWriteTime -lt $file.LastWriteTime) {
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        $copied++
      }
    }
  }
}
Write-Output "$copied file(s) copied to $Dest"
