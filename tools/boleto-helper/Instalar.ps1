$ErrorActionPreference = 'Stop'
$helperSource = Join-Path $PSScriptRoot 'BoletoHelper.ps1'
if (-not (Test-Path -LiteralPath $helperSource -PathType Leaf)) { throw 'BoletoHelper.ps1 não foi encontrado ao lado do instalador.' }

$installDirectory = Join-Path $env:LOCALAPPDATA 'TexCotton\BoletoHelper'
$configPath = Join-Path $installDirectory 'config.json'
$helperInstalled = Join-Path $installDirectory 'BoletoHelper.ps1'
$stopSource = Join-Path $PSScriptRoot 'Parar.ps1'
$stopInstalled = Join-Path $installDirectory 'Parar.ps1'
$startupDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$shortcutPath = Join-Path $startupDirectory 'TexCotton - Auxiliar de boletos.lnk'
$defaultDestination = 'V:\Financeiro\Contas à Receber\Administrativo - Atualização\Banco\Boletos (2ª via)'

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null

$oldToken = $null
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  try { $oldConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json; $oldToken = [string]$oldConfig.Token } catch {}
  if ((Read-Host 'Já existe uma configuração. Deseja substituí-la e gerar uma nova chave? [s/N]') -notmatch '^(s|S)$') {
    Write-Host 'Instalação cancelada; a configuração atual foi preservada.'
    exit 0
  }
  if (-not [string]::IsNullOrWhiteSpace($oldToken)) {
    try {
      Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17834/api/stop' -Headers @{ 'X-ST-Boleto-Token' = $oldToken } -TimeoutSec 2 | Out-Null
      Start-Sleep -Milliseconds 700
    } catch {}
  }
}

Write-Host ''
Write-Host 'Informe a pasta exclusiva para salvar as segundas vias.'
Write-Host 'O Chrome continuará usando sua pasta Downloads normal para os demais arquivos.'
$enteredDestination = Read-Host ('Pasta de destino [{0}]' -f $defaultDestination)
$destination = if ([string]::IsNullOrWhiteSpace($enteredDestination)) { $defaultDestination } else { $enteredDestination.Trim().Trim('"') }

if (-not [System.IO.Path]::IsPathRooted($destination)) { throw 'Informe um caminho absoluto de pasta.' }
if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
  throw 'A pasta informada não existe ou não está acessível nesta sessão do Windows. Confira a unidade de rede e tente novamente.'
}

$randomBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
$token = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$config = @{
  Version = 1
  Token = $token
  DestinationDirectory = [System.IO.Path]::GetFullPath($destination)
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configPath -Encoding UTF8
Copy-Item -LiteralPath $helperSource -Destination $helperInstalled -Force
if (-not (Test-Path -LiteralPath $stopSource -PathType Leaf)) { throw 'Parar.ps1 não foi encontrado ao lado do instalador.' }
Copy-Item -LiteralPath $stopSource -Destination $stopInstalled -Force

$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "' + $helperInstalled + '"'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $installDirectory
$shortcut.WindowStyle = 7
$shortcut.Description = 'Auxiliar local para salvar PDFs de segunda via do Systextil'
$shortcut.Save()
Start-Process -FilePath $powerShellPath -ArgumentList $arguments -WindowStyle Minimized

Write-Host ''
Write-Host 'Instalação concluída.'
Write-Host ('Pasta configurada: {0}' -f $destination)
Write-Host 'O auxiliar iniciará automaticamente quando você entrar no Windows.'
Write-Host ''
Write-Host 'CHAVE DE PAREAMENTO (copie para o painel do Tampermonkey):'
Write-Host $token -ForegroundColor Yellow
Write-Host ''
Write-Host 'A chave também está armazenada somente no perfil local do Windows, em config.json.'
Write-Host 'Não compartilhe essa chave. O auxiliar aceita conexões apenas de 127.0.0.1.'
