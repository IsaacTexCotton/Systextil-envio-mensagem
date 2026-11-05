$ErrorActionPreference = 'Stop'
$configPath = Join-Path $env:LOCALAPPDATA 'TexCotton\BoletoHelper\config.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Configuração local não encontrada.' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$config.Token)) { throw 'Chave local não encontrada na configuração.' }
try {
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17834/api/stop' -Headers @{ 'X-ST-Boleto-Token' = [string]$config.Token } -TimeoutSec 5 | Out-Null
  Write-Host 'Solicitação de encerramento enviada ao auxiliar.'
} catch {
  Write-Host 'O auxiliar não respondeu. Ele pode já estar encerrado.'
}
