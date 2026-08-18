[CmdletBinding()]
param(
    [switch]$DownloadOnly
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

function Show-InstallerError {
    param([string]$Message)

    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        'Mailspring Installer',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}

function New-InstallerForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Installing Mailspring'
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ShowInTaskbar = $true
    $form.TopMost = $true
    $form.ClientSize = New-Object System.Drawing.Size(470, 170)
    $form.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 252)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = 'Mailspring'
    $titleLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16)
    $titleLabel.Location = New-Object System.Drawing.Point(24, 22)
    $titleLabel.AutoSize = $true

    $detailLabel = New-Object System.Windows.Forms.Label
    $detailLabel.Text = 'Preparing a verified local installer...'
    $detailLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    $detailLabel.ForeColor = [System.Drawing.Color]::FromArgb(71, 85, 105)
    $detailLabel.Location = New-Object System.Drawing.Point(26, 60)
    $detailLabel.Size = New-Object System.Drawing.Size(414, 20)

    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.Text = 'Starting...'
    $statusLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
    $statusLabel.Location = New-Object System.Drawing.Point(26, 92)
    $statusLabel.Size = New-Object System.Drawing.Size(414, 20)

    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Location = New-Object System.Drawing.Point(28, 120)
    $progressBar.Size = New-Object System.Drawing.Size(414, 18)
    $progressBar.Style = 'Continuous'
    $progressBar.Minimum = 0
    $progressBar.Maximum = 100
    $progressBar.Value = 5

    $form.Controls.Add($titleLabel)
    $form.Controls.Add($detailLabel)
    $form.Controls.Add($statusLabel)
    $form.Controls.Add($progressBar)

    return @{
        Form = $form
        DetailLabel = $detailLabel
        StatusLabel = $statusLabel
        ProgressBar = $progressBar
    }
}

function Update-InstallerUi {
    param(
        [hashtable]$Ui,
        [int]$Percent,
        [string]$Status
    )

    $Ui.ProgressBar.Value = [Math]::Max(
        $Ui.ProgressBar.Minimum,
        [Math]::Min($Percent, $Ui.ProgressBar.Maximum))
    $Ui.StatusLabel.Text = $Status
    [System.Windows.Forms.Application]::DoEvents()
}

$ui = $null
try {
    $shareRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $manifestPath = Join-Path $shareRoot 'release.json'
    $sourceInstaller = Join-Path $shareRoot 'MailspringSetup.exe'

    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "Release manifest is missing: $manifestPath"
    }
    if (-not (Test-Path -LiteralPath $sourceInstaller)) {
        throw "Mailspring installer is missing: $sourceInstaller"
    }

    $release = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if (-not $release.version -or -not $release.installerSha256) {
        throw "Release manifest is invalid: $manifestPath"
    }

    $ui = New-InstallerForm
    $ui.Form.Show()
    Update-InstallerUi -Ui $ui -Percent 12 -Status "Preparing Mailspring $($release.version)..."

    $localRoot = Join-Path $env:LOCALAPPDATA 'MSSE\Mailspring\Downloads'
    $localRelease = Join-Path $localRoot $release.version
    New-Item -ItemType Directory -Path $localRelease -Force | Out-Null
    $localInstaller = Join-Path $localRelease 'MailspringSetup.exe'
    $partialInstaller = "$localInstaller.partial"

    Update-InstallerUi -Ui $ui -Percent 35 -Status 'Downloading the installer to this PC...'
    Copy-Item -LiteralPath $sourceInstaller -Destination $partialInstaller -Force

    Update-InstallerUi -Ui $ui -Percent 62 -Status 'Verifying the installer...'
    $actualHash = (Get-FileHash -LiteralPath $partialInstaller -Algorithm SHA256).Hash
    if ($actualHash -ne $release.installerSha256) {
        throw "Installer verification failed. Expected $($release.installerSha256), received $actualHash."
    }
    Move-Item -LiteralPath $partialInstaller -Destination $localInstaller -Force

    if ($DownloadOnly) {
        Update-InstallerUi -Ui $ui -Percent 100 -Status 'Download complete.'
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.MessageBox]::Show(
            "Mailspring $($release.version) was downloaded to:`n$localInstaller",
            'Mailspring Installer',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        return
    }

    Update-InstallerUi -Ui $ui -Percent 78 -Status 'Starting the local installer...'
    $installerProcess = Start-Process -FilePath $localInstaller -PassThru
    $ui.Form.TopMost = $false
    $installerProcess.WaitForExit()

    Update-InstallerUi -Ui $ui -Percent 100 -Status 'Mailspring is ready.'
    Start-Sleep -Milliseconds 600
} catch {
    Show-InstallerError -Message $_.Exception.Message
} finally {
    if ($ui -and $ui.Form) {
        $ui.Form.Close()
        $ui.Form.Dispose()
    }
}
