[CmdletBinding()]
param(
    [string]$RepoRoot = 'D:\Codex\MailClient',
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$PublishRoot = '\\msse-files\Apps\MailSpring'
)

$ErrorActionPreference = 'Stop'

$resolvedRepo = (Resolve-Path -LiteralPath $RepoRoot).Path
$installer = Join-Path $resolvedRepo 'app\dist\MailspringSetup.exe'
$packagedExe = Join-Path $resolvedRepo 'app\dist\Mailspring-win32-x64\Mailspring.exe'
$deploymentRoot = Join-Path $resolvedRepo 'deployment\windows'
$package = Get-Content -Raw -LiteralPath (Join-Path $resolvedRepo 'app\package.json') |
    ConvertFrom-Json

if ($package.version -ne $Version) {
    throw "app/package.json is version $($package.version), expected $Version."
}
if (-not (Test-Path -LiteralPath $installer)) {
    throw "Installer is missing: $installer"
}
if (-not (Test-Path -LiteralPath $packagedExe)) {
    throw "Packaged application is missing: $packagedExe"
}

$productVersion = (Get-Item -LiteralPath $packagedExe).VersionInfo.ProductVersion
if ($productVersion -and -not $productVersion.StartsWith($Version)) {
    throw "Packaged Mailspring version is $productVersion, expected $Version."
}

$installerItem = Get-Item -LiteralPath $installer
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
$manifest = [ordered]@{
    version = $Version
    commit = (git -C $resolvedRepo rev-parse HEAD).Trim()
    installer = 'MailspringSetup.exe'
    installerBytes = $installerItem.Length
    installerSha256 = $installerHash
    packagedProductVersion = $productVersion
    publishedAt = [DateTimeOffset]::Now.ToString('o')
}

New-Item -ItemType Directory -Path $PublishRoot -Force | Out-Null
$versionRoot = Join-Path $PublishRoot (Join-Path 'releases' $Version)
New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null

$deploymentFiles = @(
    'Install-Mailspring.cmd',
    'Install-Mailspring.vbs',
    'Install-Mailspring.ps1',
    'README.txt'
)

foreach ($targetRoot in @($versionRoot, $PublishRoot)) {
    Copy-Item -LiteralPath $installer -Destination (Join-Path $targetRoot 'MailspringSetup.exe') -Force
    foreach ($file in $deploymentFiles) {
        Copy-Item -LiteralPath (Join-Path $deploymentRoot $file) -Destination $targetRoot -Force
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $targetRoot 'release.json') -Encoding utf8
    "$installerHash  MailspringSetup.exe" |
        Set-Content -LiteralPath (Join-Path $targetRoot 'MailspringSetup.exe.sha256') -Encoding ascii
}

$publishedInstaller = Join-Path $PublishRoot 'MailspringSetup.exe'
$publishedHash = (Get-FileHash -LiteralPath $publishedInstaller -Algorithm SHA256).Hash
if ($publishedHash -ne $installerHash) {
    throw "Published installer verification failed. Expected $installerHash, received $publishedHash."
}

$manifest | ConvertTo-Json
