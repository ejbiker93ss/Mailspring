[CmdletBinding()]
param(
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appRoot = Join-Path $repoRoot 'app'
$electron = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'
$mailsync = Join-Path $appRoot 'mailsync.exe'

function Assert-File([string]$path, [string]$description) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "$description was not found at $path"
  }
}

function Get-WorkspaceDevProcesses {
  $electronFullPath = [System.IO.Path]::GetFullPath($electron)
  $mailsyncFullPath = [System.IO.Path]::GetFullPath($mailsync)

  Get-Process electron, mailsync -ErrorAction SilentlyContinue | Where-Object {
    try {
      if (-not $_.Path) { return $false }
      $processPath = [System.IO.Path]::GetFullPath($_.Path)
      return $processPath.Equals(
        $electronFullPath,
        [System.StringComparison]::OrdinalIgnoreCase
      ) -or $processPath.Equals(
        $mailsyncFullPath,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } catch {
      return $false
    }
  }
}

Assert-File $electron 'Development Electron executable'
Assert-File $mailsync 'Development mailsync executable'

Write-Host 'Fast UI development restart' -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"
Write-Host 'Builds:     skipped (frontend package and native backend)'
Write-Host 'Data:       Mailspring-dev'

$running = @(Get-WorkspaceDevProcesses)
if ($running.Count -gt 0) {
  foreach ($process in $running) {
    Write-Host "Stopping $($process.ProcessName) ($($process.Id))"
    if (-not $PlanOnly) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
} else {
  Write-Host 'No workspace development instance is running.'
}

if ($PlanOnly) {
  Write-Host 'Plan-only check passed; nothing was stopped or started.' -ForegroundColor Green
  exit 0
}

$arguments = @(
  $appRoot,
  '--enable-logging',
  '--dev'
)
$startArgs = @{
  FilePath = $electron
  ArgumentList = $arguments
  WorkingDirectory = $repoRoot
  PassThru = $true
}
$process = Start-Process @startArgs

Write-Host "Started source UI (PID $($process.Id))." -ForegroundColor Green
Write-Host 'For TS/TSX/CSS edits, press Ctrl+R in the app; no restart or rebuild is needed.'
Write-Host 'Run this shortcut again after changing Electron main-process code.'
