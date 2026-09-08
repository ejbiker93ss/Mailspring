$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$accounts = [System.Collections.Generic.List[object]]::new()
$partial = $false

# Read only named, non-secret profile values. Never enumerate password/token values.
function Read-Text($key, [string]$name) {
    $value = $key.GetValue($name)
    if ($value -is [byte[]]) {
        $value = [Text.Encoding]::Unicode.GetString($value)
    }
    if ($value -is [string]) { return $value.Trim([char]0).Trim() }
    return ''
}

$roots = @(
    'Software\Microsoft\Office\16.0\Outlook\Profiles',
    'Software\Microsoft\Office\15.0\Outlook\Profiles',
    'Software\Microsoft\Windows NT\CurrentVersion\Windows Messaging Subsystem\Profiles'
)
foreach ($rootPath in $roots) {
    $root = $null
    try {
        $root = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($rootPath)
        if (-not $root) { continue }
        foreach ($profile in $root.GetSubKeyNames()) {
            $collection = $null
            try {
                $collection = $root.OpenSubKey("$profile\9375CFF0413111d3B88A00104B2A6676")
                if (-not $collection) { continue }
                foreach ($child in $collection.GetSubKeyNames()) {
                    $key = $null
                    try {
                        $key = $collection.OpenSubKey($child)
                        if (-not $key) { continue }
                        $email = Read-Text $key 'Email'
                        if (-not $email) { $email = Read-Text $key 'SMTP Email Address' }
                        if (-not $email) { $email = Read-Text $key 'Account Name' }
                        $imap = Read-Text $key 'IMAP Server'
                        $pop = Read-Text $key 'POP3 Server'
                        $kind = if ($imap) { 'imap' } elseif ($pop) { 'pop' } else { 'unknown' }
                        $accounts.Add(@{
                            emailAddress = $email
                            name = Read-Text $key 'Display Name'
                            kind = $kind
                            imap_host = $imap
                            smtp_host = Read-Text $key 'SMTP Server'
                            imap_username = Read-Text $key 'IMAP User Name'
                            smtp_username = Read-Text $key 'SMTP User Name'
                            imap_port = $key.GetValue('IMAP Port')
                            smtp_port = $key.GetValue('SMTP Port')
                        })
                    } catch { $partial = $true } finally { if ($key) { $key.Dispose() } }
                }
            } catch { $partial = $true } finally { if ($collection) { $collection.Dispose() } }
        }
    } catch { $partial = $true } finally { if ($root) { $root.Dispose() } }
}

# Supplement profiles with the supported object model only if classic Outlook is
# already running. Never launch Outlook, prompt for a profile, or read credentials.
if (Get-Process OUTLOOK -ErrorAction SilentlyContinue) {
    $outlook = $null
    $session = $null
    $collection = $null
    try {
        $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        $session = $outlook.Session
        $collection = $session.Accounts
        for ($i = 1; $i -le $collection.Count; $i++) {
            $account = $null
            try {
                $account = $collection.Item($i)
                $kind = switch ([int]$account.AccountType) { 0 { 'exchange' } 1 { 'imap' } 2 { 'pop' } default { 'unknown' } }
                $accounts.Add(@{ emailAddress = $account.SmtpAddress; name = $account.DisplayName; kind = $kind })
            } finally { if ($account) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($account) } }
        }
    } catch { $partial = $true } finally {
        foreach ($item in @($collection, $session, $outlook)) {
            if ($item) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($item) }
        }
    }
}
@{ accounts = @($accounts.ToArray()); partial = $partial } | ConvertTo-Json -Depth 4 -Compress
