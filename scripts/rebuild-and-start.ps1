[CmdletBinding()]
param(
  [switch]$SkipBackend,
  [switch]$SkipFrontend,
  [switch]$NoStart,
  [switch]$PlanOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$syncRoot = Join-Path $repoRoot 'mailsync'
$syncProject = Join-Path $syncRoot 'Windows\mailsync.vcxproj'
$syncOutput = Join-Path $syncRoot 'Windows\Release\mailsync.exe'
$appRoot = Join-Path $repoRoot 'app'
$appSync = Join-Path $appRoot 'mailsync.exe'
$appDist = Join-Path $appRoot 'dist\Mailspring-win32-x64'
$appExecutable = Join-Path $appDist 'Mailspring.exe'
$packagedSync = Join-Path $appDist 'resources\app.asar.unpacked\mailsync.exe'
$frontendBuild = Join-Path $appRoot 'build\build.js'
$vcpkgInstalled = Join-Path $syncRoot 'vcpkg_installed\x86-windows'
$buildLogDirectory = Join-Path $repoRoot 'node_modules\.cache\mailspring-build\logs'

function Write-Step([string]$message) {
  Write-Host "`n==> $message" -ForegroundColor Cyan
}

function Assert-File([string]$path, [string]$description) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "$description was not found at $path"
  }
}

function Find-MSBuild {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    $candidate = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' |
      Select-Object -First 1
    if ($candidate) { return $candidate }
  }

  $command = Get-Command msbuild.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw 'MSBuild was not found. Install Visual Studio Build Tools with the C++ workload.'
}

function Get-InstalledToolset([string]$msbuildPath) {
  $ancestor = Split-Path $msbuildPath
  while ($ancestor) {
    $vcToolsRoot = Join-Path $ancestor 'VC\Tools\MSVC'
    if (Test-Path -LiteralPath $vcToolsRoot) {
      $version = Get-ChildItem -LiteralPath $vcToolsRoot -Directory |
        Sort-Object Name -Descending |
        Select-Object -First 1 -ExpandProperty Name
      if ($version -match '^14\.3') { return 'v143' }
      if ($version -match '^14\.2') { return 'v142' }
    }
    $parent = Split-Path $ancestor
    if (-not $parent -or $parent -eq $ancestor) { break }
    $ancestor = $parent
  }
  return $null
}

function Stop-WorkspaceBuild {
  if (-not (Test-Path -LiteralPath $appDist)) { return }
  $distPrefix = [System.IO.Path]::GetFullPath($appDist).TrimEnd('\') + '\'

  Get-Process Mailspring, mailsync -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $processPath = $_.Path
      if ($processPath -and [System.IO.Path]::GetFullPath($processPath).StartsWith(
          $distPrefix,
          [System.StringComparison]::OrdinalIgnoreCase
        )) {
        Write-Host "Stopping workspace process $($_.ProcessName) ($($_.Id))"
        Stop-Process -Id $_.Id -Force
      }
    } catch {
      Write-Warning "Could not inspect or stop process $($_.Id): $($_.Exception.Message)"
    }
  }
}

Assert-File $syncProject 'Mailsync project'
Assert-File $frontendBuild 'Frontend build script'

$msbuild = Find-MSBuild
$toolset = Get-InstalledToolset $msbuild
if (-not $toolset) {
  throw "Could not determine the installed C++ platform toolset beside $msbuild"
}

Write-Host "Repository: $repoRoot"
Write-Host "MSBuild:    $msbuild"
Write-Host "Toolset:    $toolset"
Write-Host "Backend:    $(if ($SkipBackend) { 'skip' } else { 'build' })"
Write-Host "Frontend:   $(if ($SkipFrontend) { 'skip' } else { 'package' })"
Write-Host "Launch:     $(if ($NoStart) { 'no' } else { 'yes' })"

if ($PlanOnly) {
  Write-Host 'Plan-only check passed.' -ForegroundColor Green
  exit 0
}

New-Item -ItemType Directory -Force -Path $buildLogDirectory | Out-Null

if (-not $SkipBackend) {
  Write-Step 'Building native mailsync backend'
  $msbuildArgs = @(
    $syncProject,
    '/p:Configuration=Release',
    '/p:Platform=Win32',
    "/p:PlatformToolset=$toolset",
    '/p:BuildProjectReferences=false',
    '/p:MultiProcessorCompilation=false',
    "/p:_ZVcpkgCurrentInstalledDir=$vcpkgInstalled\",
    '/v:minimal'
  )
  & $msbuild @msbuildArgs
  if ($LASTEXITCODE -ne 0) { throw "Backend build failed with exit code $LASTEXITCODE" }
  Assert-File $syncOutput 'Built mailsync executable'
  Copy-Item -LiteralPath $syncOutput -Destination $appSync -Force
}

if (-not $SkipFrontend) {
  Write-Step 'Stopping the previous workspace build before packaging'
  Stop-WorkspaceBuild

  Write-Step 'Packaging Electron frontend'
  $frontendLog = Join-Path $buildLogDirectory 'frontend-build.log'
  & node $frontendBuild 2>&1 | Tee-Object -FilePath $frontendLog
  if ($LASTEXITCODE -ne 0) {
    throw "Frontend build failed with exit code $LASTEXITCODE. See $frontendLog"
  }
}

Assert-File $appExecutable 'Packaged Mailspring executable'
Assert-File $packagedSync 'Packaged mailsync executable'

if (-not $SkipBackend) {
  Write-Step 'Verifying packaged backend'
  $sourceHash = (Get-FileHash -LiteralPath $appSync -Algorithm SHA256).Hash
  $packagedHash = (Get-FileHash -LiteralPath $packagedSync -Algorithm SHA256).Hash
  if ($sourceHash -ne $packagedHash) {
    throw 'The packaged mailsync executable does not match the newly built backend.'
  }
  Write-Host "Backend SHA-256: $sourceHash"
}

if (-not $NoStart) {
  Write-Step 'Launching rebuilt Mailspring'
  Stop-WorkspaceBuild
  $process = Start-Process -FilePath $appExecutable -WorkingDirectory $appDist -PassThru
  Write-Host "Started Mailspring (PID $($process.Id))"
}

Write-Host "`nBuild workflow completed successfully." -ForegroundColor Green
Write-Host "App: $appExecutable"
