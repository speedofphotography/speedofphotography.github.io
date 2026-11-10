# Sets up a new client gallery folder: an unguessable code, a filled-in gallery.json,
# and the client link copied to the clipboard. Export the photos into the folder, then upload it to R2.
# Run: right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File new-gallery.ps1
param(
  [string]$Client,
  [string]$Car,
  [string]$Title,
  [string]$Message = "Thanks for a great shoot! Let me know if you'd like any extra edits.",
  [int]$KeepDays = 60,
  [string]$Root = (Join-Path ([Environment]::GetFolderPath("MyPictures")) "SOP Deliveries"),
  [switch]$NoOpen
)

if (-not $Client) { $Client = Read-Host "Client name" }
if (-not $Car) { $Car = Read-Host "Car (optional, press Enter to skip)" }
if (-not $Client) { Write-Host "A client name is needed."; exit 1 }

function Get-Slug([string]$text) {
  $plain = $text.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
  return (($plain.ToLower() -replace '[^a-z0-9]+', '-').Trim('-'))
}

# 6 random letters/numbers from a secure generator: about 2 billion possibilities, so links can't be guessed.
$alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
$bytes = New-Object byte[] 6
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$suffix = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })

$name = Get-Slug ("$Client $Car")
if ($name.Length -gt 40) { $name = $name.Substring(0, 40).Trim('-') }
$code = if ($name) { "$name-$suffix" } else { $suffix }

if (-not $Title) { $Title = if ($Car) { "$Client's $Car" } else { "$Client's photos" } }
$today = Get-Date
$meta = [ordered]@{
  title   = $Title
  client  = $Client
  date    = $today.ToString("yyyy-MM-dd")
  message = $Message
  expires = $today.AddDays($KeepDays).ToString("yyyy-MM-dd")
}

$folder = Join-Path $Root $code
New-Item -ItemType Directory -Force -Path $folder | Out-Null
# UTF-8 without a byte-order mark, so accents and emoji in the message survive.
# (Windows PowerShell writes ' & < > as \u codes; put them back so the file stays easy to edit by hand.)
$json = ($meta | ConvertTo-Json) -replace '\\u0027', "'" -replace '\\u0026', '&' -replace '\\u003c', '<' -replace '\\u003e', '>'
[IO.File]::WriteAllText((Join-Path $folder "gallery.json"), $json, (New-Object Text.UTF8Encoding $false))

$link = "https://speedofphotography.com/g/$code/"
try { Set-Clipboard -Value $link } catch {}

Write-Host ""
Write-Host "Gallery folder: $folder"
Write-Host "Client link:    $link  (copied)"
Write-Host "Expires:        $($meta.expires)  (edit gallery.json to change)"
Write-Host ""
Write-Host "Next: export the photos into the folder, upload the folder to R2 > sop-deliveries, send the link."
if (-not $NoOpen) { explorer.exe $folder }
