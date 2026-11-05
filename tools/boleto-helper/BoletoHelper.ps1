param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ServiceVersion = '1.0.0'
$script:Port = 17834
$script:MaxPdfBytes = 25MB
$script:ConfigPath = Join-Path $env:LOCALAPPDATA 'TexCotton\BoletoHelper\config.json'
$script:StopRequested = $false

function Write-JsonResponse {
  param([System.IO.Stream]$Stream, [int]$StatusCode, [object]$Payload)
  $json = if ($null -eq $Payload) { '' } else { ConvertTo-Json -InputObject $Payload -Compress -Depth 4 }
  $body = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
  $reason = switch ($StatusCode) {
    200 { 'OK' } 201 { 'Created' } 204 { 'No Content' } 400 { 'Bad Request' }
    401 { 'Unauthorized' } 403 { 'Forbidden' } 404 { 'Not Found' } 411 { 'Length Required' }
    413 { 'Payload Too Large' } 415 { 'Unsupported Media Type' } 409 { 'Conflict' }
    500 { 'Internal Server Error' } 503 { 'Service Unavailable' } default { 'Response' }
  }
  $crlf = [System.Environment]::NewLine
  $header = @(
    "HTTP/1.1 $StatusCode $reason"
    'Content-Type: application/json; charset=utf-8'
    "Content-Length: $($body.Length)"
    'Connection: close'
    'Cache-Control: no-store'
    'Access-Control-Allow-Origin: *'
    'Access-Control-Allow-Methods: GET, POST, OPTIONS'
    'Access-Control-Allow-Headers: Content-Type, X-ST-Boleto-Token'
    'Access-Control-Max-Age: 600'
    ''
    ''
  ) -join $crlf
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($body.Length -gt 0) { $Stream.Write($body, 0, $body.Length) }
  $Stream.Flush()
}

function New-RequestException {
  param([int]$StatusCode, [string]$Message)
  $exception = [System.InvalidOperationException]::new($Message)
  $exception.Data['StatusCode'] = $StatusCode
  return $exception
}

function Read-HttpRequest {
  param([System.IO.Stream]$Stream)
  $headerBytes = New-Object 'System.Collections.Generic.List[byte]'
  $oneByte = New-Object byte[] 1
  $headerComplete = $false
  $crlfcrlf = [byte[]]@(13, 10, 13, 10)

  while ($headerBytes.Count -lt 16384) {
    $read = $Stream.Read($oneByte, 0, 1)
    if ($read -le 0) { throw (New-RequestException 400 'Cabeçalho HTTP incompleto.') }
    [void]$headerBytes.Add($oneByte[0])
    $count = $headerBytes.Count
    if (
      $count -ge 4 -and
      $headerBytes[$count - 4] -eq $crlfcrlf[0] -and
      $headerBytes[$count - 3] -eq $crlfcrlf[1] -and
      $headerBytes[$count - 2] -eq $crlfcrlf[2] -and
      $headerBytes[$count - 1] -eq $crlfcrlf[3]
    ) {
      $headerComplete = $true
      break
    }
  }
  if (-not $headerComplete) { throw (New-RequestException 400 'Cabeçalho HTTP excedeu o limite permitido.') }

  $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
  $lines = $headerText -split [regex]::Escape([System.Environment]::NewLine)
  $requestParts = $lines[0].Split(' ')
  if ($requestParts.Length -lt 2) { throw (New-RequestException 400 'Linha inicial HTTP inválida.') }

  $method = $requestParts[0].ToUpperInvariant()
  $target = $requestParts[1]
  if (-not $target.StartsWith('/')) { throw (New-RequestException 400 'Formato de URL HTTP inválido.') }

  $headers = @{}
  for ($index = 1; $index -lt $lines.Length; $index += 1) {
    $line = $lines[$index]
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $separator = $line.IndexOf(':')
    if ($separator -le 0) { continue }
    $key = $line.Substring(0, $separator).Trim().ToLowerInvariant()
    $headers[$key] = $line.Substring($separator + 1).Trim()
  }

  if ($headers.ContainsKey('transfer-encoding')) {
    throw (New-RequestException 411 'Transfer-Encoding não é aceito; envie Content-Length.')
  }
  $contentLength = 0
  if ($headers.ContainsKey('content-length')) {
    if (-not [int]::TryParse($headers['content-length'], [ref]$contentLength) -or $contentLength -lt 0) {
      throw (New-RequestException 400 'Content-Length inválido.')
    }
  }
  if ($contentLength -gt $script:MaxPdfBytes) {
    throw (New-RequestException 413 'O PDF excede o tamanho máximo permitido.')
  }

  if ($headers.ContainsKey('expect') -and $headers['expect'] -match '100-continue') {
    $continueText = 'HTTP/1.1 100 Continue' + [System.Environment]::NewLine + [System.Environment]::NewLine
    $continue = [System.Text.Encoding]::ASCII.GetBytes($continueText)
    $Stream.Write($continue, 0, $continue.Length)
    $Stream.Flush()
  }

  $body = New-Object byte[] $contentLength
  $offset = 0
  while ($offset -lt $contentLength) {
    $read = $Stream.Read($body, $offset, $contentLength - $offset)
    if ($read -le 0) { throw (New-RequestException 400 'Corpo HTTP incompleto.') }
    $offset += $read
  }

  return @{ Method = $method; Target = $target; Headers = $headers; Body = $body }
}

function Test-RequestToken {
  param([string]$ProvidedToken, [string]$ExpectedToken)
  if ([string]::IsNullOrEmpty($ProvidedToken) -or [string]::IsNullOrEmpty($ExpectedToken)) { return $false }
  $providedBytes = [System.Text.Encoding]::UTF8.GetBytes($ProvidedToken)
  $expectedBytes = [System.Text.Encoding]::UTF8.GetBytes($ExpectedToken)
  if ($providedBytes.Length -ne $expectedBytes.Length) { return $false }
  $difference = 0
  for ($index = 0; $index -lt $providedBytes.Length; $index += 1) {
    $difference = $difference -bor ($providedBytes[$index] -bxor $expectedBytes[$index])
  }
  return $difference -eq 0
}

function Get-QueryParameter {
  param([System.Uri]$Uri, [string]$Name)
  $query = $Uri.Query.TrimStart('?')
  if ([string]::IsNullOrEmpty($query)) { return $null }
  foreach ($pair in $query.Split('&')) {
    $parts = $pair.Split('=', 2)
    $key = [System.Uri]::UnescapeDataString($parts[0].Replace('+', ' '))
    if ($key -ceq $Name) {
      if ($parts.Length -lt 2) { return '' }
      return [System.Uri]::UnescapeDataString($parts[1].Replace('+', ' '))
    }
  }
  return $null
}

function Test-SafePdfName {
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name) -or $Name.Length -gt 180) { return $false }
  if ([System.IO.Path]::GetFileName($Name) -cne $Name) { return $false }
  if ($Name -match '[<>:"/\\|?*\x00-\x1F]' -or $Name -notmatch '\.pdf$' -or $Name -match '[. ]+$') { return $false }
  return $true
}

function Test-PdfBytes {
  param([byte[]]$Bytes)
  if ($null -eq $Bytes -or $Bytes.Length -lt 8 -or $Bytes.Length -gt $script:MaxPdfBytes) { return $false }
  if ([System.Text.Encoding]::ASCII.GetString($Bytes, 0, 5) -cne '%PDF-') { return $false }
  $tailStart = [Math]::Max(0, $Bytes.Length - 2048)
  $tail = [System.Text.Encoding]::ASCII.GetString($Bytes, $tailStart, $Bytes.Length - $tailStart)
  return $tail.Contains('%%EOF')
}

function Save-PdfWithoutOverwrite {
  param([string]$Directory, [string]$RequestedName, [byte[]]$Bytes)
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw (New-RequestException 503 'A pasta de destino configurada não está acessível.')
  }
  $temporaryPath = Join-Path $Directory ('.st-boleto-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($RequestedName)
  try {
    [System.IO.File]::WriteAllBytes($temporaryPath, $Bytes)
    for ($attempt = 0; $attempt -lt 1000; $attempt += 1) {
      $candidateName = if ($attempt -eq 0) { $RequestedName } else { '{0} ({1}).pdf' -f $baseName, ($attempt + 1) }
      $candidatePath = Join-Path $Directory $candidateName
      try {
        [System.IO.File]::Move($temporaryPath, $candidatePath)
        return $candidateName
      } catch [System.IO.IOException] {
        if (Test-Path -LiteralPath $candidatePath) { continue }
        throw
      }
    }
    throw (New-RequestException 409 'Não foi possível encontrar um nome livre para o arquivo.')
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-Request {
  param([hashtable]$Request, [System.Net.Sockets.TcpClient]$Client, [pscustomobject]$Config)
  if (-not $Client.Client.RemoteEndPoint.Address.IsLoopback) {
    return @{ Status = 403; Payload = @{ ok = $false; error = 'loopback_only' }; Stop = $false }
  }
  if ([string]$Request.Headers['host'] -cne ('127.0.0.1:' + $script:Port)) {
    return @{ Status = 403; Payload = @{ ok = $false; error = 'invalid_host' }; Stop = $false }
  }
  if ($Request.Method -eq 'OPTIONS') { return @{ Status = 204; Payload = $null; Stop = $false } }

  try {
    $uri = [System.Uri]::new('http://127.0.0.1:' + $script:Port + $Request.Target)
  } catch {
    return @{ Status = 400; Payload = @{ ok = $false; error = 'invalid_url' }; Stop = $false }
  }

  if ($Request.Method -eq 'GET' -and $uri.AbsolutePath -ceq '/health') {
    return @{ Status = 200; Payload = @{ ok = $true; service = 'TexCottonBoletoHelper'; version = $script:ServiceVersion }; Stop = $false }
  }

  $providedToken = [string]$Request.Headers['x-st-boleto-token']
  if (-not (Test-RequestToken -ProvidedToken $providedToken -ExpectedToken ([string]$Config.Token))) {
    return @{ Status = 401; Payload = @{ ok = $false; error = 'unauthorized' }; Stop = $false }
  }

  if ($Request.Method -eq 'GET' -and $uri.AbsolutePath -ceq '/api/ready') {
    if (-not (Test-Path -LiteralPath ([string]$Config.DestinationDirectory) -PathType Container)) {
      return @{ Status = 503; Payload = @{ ok = $false; error = 'destination_unavailable' }; Stop = $false }
    }
    return @{ Status = 200; Payload = @{ ok = $true; destinationReady = $true; version = $script:ServiceVersion }; Stop = $false }
  }

  if ($Request.Method -eq 'POST' -and $uri.AbsolutePath -ceq '/api/pdf') {
    if (-not $Request.Headers.ContainsKey('content-type') -or $Request.Headers['content-type'] -notmatch '^application/pdf(?:\s*;|$)') {
      return @{ Status = 415; Payload = @{ ok = $false; error = 'content_type_must_be_pdf' }; Stop = $false }
    }
    if ($Request.Body.Length -eq 0) { return @{ Status = 400; Payload = @{ ok = $false; error = 'empty_body' }; Stop = $false } }
    $name = Get-QueryParameter -Uri $uri -Name 'name'
    if (-not (Test-SafePdfName -Name $name)) { return @{ Status = 400; Payload = @{ ok = $false; error = 'invalid_file_name' }; Stop = $false } }
    if (-not (Test-PdfBytes -Bytes $Request.Body)) { return @{ Status = 400; Payload = @{ ok = $false; error = 'invalid_pdf' }; Stop = $false } }

    try {
      $savedName = Save-PdfWithoutOverwrite -Directory ([string]$Config.DestinationDirectory) -RequestedName $name -Bytes $Request.Body
      return @{ Status = 201; Payload = @{ ok = $true; fileName = $savedName; bytes = $Request.Body.Length }; Stop = $false }
    } catch {
      $status = 500
      if ($_.Exception.Data.Contains('StatusCode')) { $status = [int]$_.Exception.Data['StatusCode'] }
      return @{ Status = $status; Payload = @{ ok = $false; error = 'save_failed' }; Stop = $false }
    }
  }

  if ($Request.Method -eq 'POST' -and $uri.AbsolutePath -ceq '/api/stop') {
    return @{ Status = 200; Payload = @{ ok = $true; stopping = $true }; Stop = $true }
  }
  return @{ Status = 404; Payload = @{ ok = $false; error = 'not_found' }; Stop = $false }
}

if (-not (Test-Path -LiteralPath $script:ConfigPath -PathType Leaf)) {
  Write-Error 'Configuração local não encontrada. Execute Instalar.ps1.'
  exit 1
}
try {
  $config = Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
} catch {
  Write-Error 'Não foi possível ler a configuração local do auxiliar.'
  exit 1
}
if ([string]$config.Token -notmatch '^[A-Za-z0-9_-]{43}$' -or [string]::IsNullOrWhiteSpace([string]$config.DestinationDirectory)) {
  Write-Error 'A configuração local do auxiliar está inválida.'
  exit 1
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\TexCottonBoletoHelper')
if (-not $mutex.WaitOne(0)) {
  Write-Host 'O auxiliar já está em execução.'
  exit 0
}

$listener = $null
try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $script:Port)
  $listener.Start(8)
  Write-Host ('Auxiliar de boletos ativo em 127.0.0.1:{0}. Use Parar.ps1 para encerrar.' -f $script:Port)
  while (-not $script:StopRequested) {
    $client = $null
    try {
      $client = $listener.AcceptTcpClient()
      $client.ReceiveTimeout = 30000
      $client.SendTimeout = 30000
      $stream = $client.GetStream()
      try {
        $request = Read-HttpRequest -Stream $stream
        $result = Invoke-Request -Request $request -Client $client -Config $config
        Write-JsonResponse -Stream $stream -StatusCode $result.Status -Payload $result.Payload
        Write-Host ('{0} {1} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $request.Method, $result.Status)
        if ($result.Stop) { $script:StopRequested = $true }
      } catch {
        $status = 400
        if ($_.Exception.Data.Contains('StatusCode')) { $status = [int]$_.Exception.Data['StatusCode'] }
        try { Write-JsonResponse -Stream $stream -StatusCode $status -Payload @{ ok = $false; error = 'request_rejected' } } catch {}
      }
    } catch {
      if (-not $script:StopRequested) { Write-Host 'Uma conexão local foi encerrada antes da conclusão.' }
    } finally {
      if ($null -ne $client) { $client.Close() }
    }
  }
} catch {
  Write-Error 'Não foi possível iniciar o auxiliar local. Verifique se a porta 17834 está disponível.'
  exit 1
} finally {
  if ($null -ne $listener) { $listener.Stop() }
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
Write-Host 'Auxiliar encerrado.'
