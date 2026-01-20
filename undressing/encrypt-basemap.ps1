param(
  [string] $InputPath,

  [string] $OutputPath,

  [string] $Key = "CanvasGame-undressing-key-v1"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptPath =
  if ($PSCommandPath) { $PSCommandPath }
  else { $MyInvocation.MyCommand.Path }

$scriptDir = Split-Path -Path $scriptPath -Parent

if (-not $InputPath) { $InputPath = Join-Path $scriptDir "Basemap.png" }
if (-not $OutputPath) { $OutputPath = Join-Path $scriptDir "Basemap.enc" }

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input not found: $InputPath"
}

$plain = [System.IO.File]::ReadAllBytes($InputPath)
$keyBytes = [System.Text.Encoding]::UTF8.GetBytes($Key)
if ($keyBytes.Length -lt 1) { throw "Key must not be empty." }

$magic = [System.Text.Encoding]::ASCII.GetBytes("CBM1")
$lenBytes = [System.BitConverter]::GetBytes([UInt32]$plain.Length)

$out = New-Object byte[] ($magic.Length + $lenBytes.Length + $plain.Length)
[Array]::Copy($magic, 0, $out, 0, $magic.Length)
[Array]::Copy($lenBytes, 0, $out, $magic.Length, $lenBytes.Length)

$offset = $magic.Length + $lenBytes.Length
for ($i = 0; $i -lt $plain.Length; $i++) {
  $out[$offset + $i] = $plain[$i] -bxor $keyBytes[$i % $keyBytes.Length]
}

[System.IO.File]::WriteAllBytes($OutputPath, $out)
Write-Host "Wrote: $OutputPath"
