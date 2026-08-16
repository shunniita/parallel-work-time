param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$markdown = [System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8)
$html = (ConvertFrom-Markdown -InputObject $markdown).Html
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($OutputPath, $html, $utf8WithoutBom)
