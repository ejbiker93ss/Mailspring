param(
  [string]$SourcePath = (Join-Path $PSScriptRoot 'resources\summermail-icon-source.png')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resourceRoot = Join-Path $PSScriptRoot 'resources'
$canonicalSource = Join-Path $resourceRoot 'summermail-icon-source.png'
$windowsIcoSource = Join-Path $resourceRoot 'summermail-taskbar-source.ico'
$staticIcon = Join-Path $PSScriptRoot '..\static\images\summermail.png'
$navigationIcon = Join-Path $PSScriptRoot '..\internal_packages\account-sidebar\assets\summermail-app-icon@2x.png'
$windows75Icon = Join-Path $resourceRoot 'win\summermail-75px.png'
$windows150Icon = Join-Path $resourceRoot 'win\summermail-150px.png'
$pngOutputs = @($canonicalSource, $staticIcon, $navigationIcon, $windows75Icon, $windows150Icon)

function New-CleanedBitmap([string]$Path) {
  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  if ($bitmap.Width -ne $bitmap.Height) {
    $dimensions = "$($bitmap.Width)x$($bitmap.Height)"
    $bitmap.Dispose()
    throw "The app icon source must be square. Received $dimensions."
  }

  if ($bitmap.PixelFormat -ne [System.Drawing.Imaging.PixelFormat]::Format32bppArgb) {
    $converted = New-Object System.Drawing.Bitmap(
      $bitmap.Width,
      $bitmap.Height,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($converted)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.DrawImageUnscaled($bitmap, 0, 0)
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Dispose()
    $bitmap = $converted
  }

  # Remove only nearly invisible edge residue. The supplied artwork already
  # has a correct alpha channel; this clears stray pixels without matting or
  # changing the intended soft edge.
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)
  $data = $bitmap.LockBits(
    $rect,
    [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  try {
    $bytes = New-Object byte[] ([Math]::Abs($data.Stride) * $data.Height)
    [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    for ($index = 3; $index -lt $bytes.Length; $index += 4) {
      if ($bytes[$index] -le 8) {
        $bytes[$index - 3] = 0
        $bytes[$index - 2] = 0
        $bytes[$index - 1] = 0
        $bytes[$index] = 0
      }
    }
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  } finally {
    $bitmap.UnlockBits($data)
  }

  return $bitmap
}

function New-ResizedBitmap([System.Drawing.Bitmap]$Source, [int]$Size) {
  $bitmap = New-Object System.Drawing.Bitmap(
    $Size,
    $Size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $destination = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $graphics.DrawImage(
      $Source,
      $destination,
      0,
      0,
      $Source.Width,
      $Source.Height,
      [System.Drawing.GraphicsUnit]::Pixel,
      $attributes
    )
  } finally {
    $attributes.Dispose()
    $graphics.Dispose()
  }
  return $bitmap
}

function Save-Png([System.Drawing.Bitmap]$Source, [int]$Size, [string]$Path) {
  $bitmap = New-ResizedBitmap $Source $Size
  try {
    $directory = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
}

function Get-PngBytes([System.Drawing.Bitmap]$Source, [int]$Size) {
  $bitmap = New-ResizedBitmap $Source $Size
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return ,$stream.ToArray()
  } finally {
    $stream.Dispose()
    $bitmap.Dispose()
  }
}

function Save-Ico([System.Drawing.Bitmap]$Source, [int[]]$Sizes, [string]$Path) {
  $frames = @($Sizes | ForEach-Object {
    [pscustomobject]@{ Size = $_; Bytes = Get-PngBytes $Source $_ }
  })
  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
      $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
      $writer.Write([byte]$dimension)
      $writer.Write([byte]$dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$frame.Bytes.Length)
      $writer.Write([uint32]$offset)
      $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) {
      $writer.Write($frame.Bytes)
    }
    [System.IO.File]::WriteAllBytes($Path, $stream.ToArray())
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$cleaned = New-CleanedBitmap $resolvedSource
try {
  if ($resolvedSource -ne [System.IO.Path]::GetFullPath($canonicalSource)) {
    $cleaned.Save($canonicalSource, [System.Drawing.Imaging.ImageFormat]::Png)
  }

  Save-Png $cleaned 512 $staticIcon
  Save-Png $cleaned 44 $navigationIcon
  Save-Png $cleaned 75 $windows75Icon
  Save-Png $cleaned 150 $windows150Icon

  foreach ($size in @(16, 32, 64, 128, 256, 512)) {
    $linuxIcon = Join-Path $resourceRoot "linux\icons\$size.png"
    Save-Png $cleaned $size $linuxIcon
    $pngOutputs += $linuxIcon
  }

  $icoSizes = @(16, 20, 24, 32, 40, 48, 64, 96, 128, 256)
  $primaryIco = Join-Path $resourceRoot 'win\summermail.ico'
  Save-Ico $cleaned $icoSizes $primaryIco
  if (Test-Path -LiteralPath $windowsIcoSource) {
    [System.IO.File]::Copy($windowsIcoSource, $primaryIco, $true)
  }
  [System.IO.File]::Copy(
    $primaryIco,
    (Join-Path $resourceRoot 'win\summermail-square.ico'),
    $true
  )
} finally {
  $cleaned.Dispose()
}

& node (Join-Path $PSScriptRoot 'optimize-app-icon-pngs.js') @pngOutputs
if ($LASTEXITCODE -ne 0) {
  throw "PNG optimization failed with exit code $LASTEXITCODE."
}

Write-Output "Generated SummerMail app icons from $SourcePath"
