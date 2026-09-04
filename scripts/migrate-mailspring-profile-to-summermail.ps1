[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SourceProfile = (Join-Path $env:APPDATA 'Mailspring'),
    [string]$DestinationProfile = (Join-Path $env:APPDATA 'SummerMail')
)

$ErrorActionPreference = 'Stop'

$source = [IO.Path]::GetFullPath($SourceProfile)
$destination = [IO.Path]::GetFullPath($DestinationProfile)

if ($source -eq $destination) {
    throw 'The source and destination profiles must be different directories.'
}
if ($destination -eq [IO.Path]::GetPathRoot($destination)) {
    throw "Refusing to use a drive root as the destination: $destination"
}

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "The Mailspring profile was not found: $source"
}

$running = @(Get-Process -Name 'mailspring', 'summermail' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    $names = ($running | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
    throw "Close Mailspring and SummerMail before migrating. Still running: $names"
}

$requiredFiles = @('config.json', 'edgehill.db', 'Local State')
$optionalFiles = @('edgehill.db-wal', 'edgehill.db-shm')

foreach ($name in $requiredFiles) {
    $path = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "The required profile file is missing: $path"
    }
}

$files = @($requiredFiles)
foreach ($name in $optionalFiles) {
    if (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf) {
        $files += $name
    }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $destination "migration-backup-$timestamp"

if (-not $PSCmdlet.ShouldProcess($destination, "Back up the existing SummerMail profile and migrate Mailspring accounts and encrypted credentials from $source")) {
    return
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$backedUp = @()
$originallyAbsent = @()
try {
    foreach ($name in @($requiredFiles + $optionalFiles)) {
        $existing = Join-Path $destination $name
        if (Test-Path -LiteralPath $existing -PathType Leaf) {
            Copy-Item -LiteralPath $existing -Destination (Join-Path $backup $name) -Force
            $backedUp += $name
        } else {
            $originallyAbsent += $name
        }
    }

    foreach ($name in $files) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $destination $name) -Force
    }

    # Remove stale SQLite sidecars that did not exist in the source profile.
    foreach ($name in $optionalFiles) {
        if ($files -notcontains $name) {
            $staleSidecar = [IO.Path]::GetFullPath((Join-Path $destination $name))
            if ([IO.Path]::GetDirectoryName($staleSidecar) -ne $destination.TrimEnd('\')) {
                throw "Refusing to remove a file outside the destination profile: $staleSidecar"
            }
            Remove-Item -LiteralPath $staleSidecar -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    foreach ($name in $backedUp) {
        Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $destination $name) -Force
    }
    foreach ($name in $originallyAbsent) {
        $newFile = [IO.Path]::GetFullPath((Join-Path $destination $name))
        if ([IO.Path]::GetDirectoryName($newFile) -ne $destination.TrimEnd('\')) {
            throw "Migration failed, and rollback refused to remove a file outside the destination profile: $newFile"
        }
        Remove-Item -LiteralPath $newFile -Force -ErrorAction SilentlyContinue
    }
    throw
}

Write-Host "Migrated SummerMail account data successfully."
Write-Host "Credentials stayed encrypted on disk throughout the migration."
Write-Host "Backup: $backup"
Write-Host "You can now start SummerMail."
