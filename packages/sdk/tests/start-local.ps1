param([switch]$BuiltIdentity, [int]$IdentityPort = 8787, [int]$ApiPort = 8000)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $repository
$runtimeDirectory = Join-Path $repository ('packages/sdk/node_modules/.sdk-e2e/run-' + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
$env:CANDOR_DATA_DIR = $runtimeDirectory
$env:UV_CACHE_DIR = Join-Path $runtimeDirectory 'uv-cache'
$env:CANDOR_MODE = 'demo'
$env:SELF_MODE = 'mock'
$env:X402_MODE = 'mock'
$env:ANCHOR_MODE = 'mock'
$env:MODAL_ENABLED = 'false'
$env:CANDOR_API_URL = "http://127.0.0.1:$ApiPort"
$env:CANDOR_IDENTITY_URL = "http://127.0.0.1:$IdentityPort"
$env:PORT = [string]$IdentityPort
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$secretBytes = New-Object byte[] 32
$random.GetBytes($secretBytes)
$env:CANDOR_IDENTITY_SECRET = [Convert]::ToBase64String($secretBytes)
$random.GetBytes($secretBytes)
$env:CANDOR_IDENTITY_ADMIN_TOKEN = [Convert]::ToBase64String($secretBytes)
$random.Dispose()
[Array]::Clear($secretBytes, 0, $secretBytes.Length)
$identity = $null
$api = $null
try {
  if ($BuiltIdentity) {
    $identity = Start-Process node -WindowStyle Hidden -PassThru -ArgumentList 'services/identity/dist/main.js' -WorkingDirectory $repository -RedirectStandardOutput (Join-Path $runtimeDirectory 'identity.out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'identity.err.log')
  } else {
    $identity = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-Command', 'pnpm --filter @candor/identity dev' -WorkingDirectory $repository -RedirectStandardOutput (Join-Path $runtimeDirectory 'identity.out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'identity.err.log')
  }
  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    try { Invoke-RestMethod "$env:CANDOR_IDENTITY_URL/health" -TimeoutSec 3 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
  }
  Invoke-RestMethod "$env:CANDOR_IDENTITY_URL/health" -TimeoutSec 3 | Out-Null
  if ($identity.HasExited) { throw 'The SDK identity process exited before validation' }
  uv run --no-sync --project services/api candor-api seed --reset
  if ($LASTEXITCODE -ne 0) { throw 'API seed failed' }
  $api = Start-Process (Join-Path $repository 'services/api/.venv/Scripts/python.exe') -WindowStyle Hidden -PassThru -ArgumentList '-m', 'candor_api.cli', 'serve', '--port', ([string]$ApiPort) -WorkingDirectory $repository -RedirectStandardOutput (Join-Path $runtimeDirectory 'api.out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'api.err.log')
  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    try { Invoke-RestMethod "$env:CANDOR_API_URL/v1/health" -TimeoutSec 3 | Out-Null; break } catch { Start-Sleep -Seconds 1 }
  }
  Invoke-RestMethod "$env:CANDOR_API_URL/v1/health" -TimeoutSec 3 | Out-Null
  if ($api.HasExited) { throw 'The SDK API process exited before validation' }
  Write-Output "Local SDK integration services are healthy on $IdentityPort and $ApiPort."
  $env:CANDOR_E2E = '1'
  pnpm --filter '@candor/sdk' test
  $testExitCode = $LASTEXITCODE
  pnpm --filter '@candor/sdk' seed:demo
  $demoExitCode = $LASTEXITCODE
  Write-Output "Integration exit: $testExitCode; demo CLI exit: $demoExitCode"
} finally {
  foreach ($server in @($identity, $api)) {
    if ($null -ne $server -and -not $server.HasExited) {
      try { $server.Kill() } catch { Write-Warning 'Sandbox prevented stopping an SDK test server.' }
    }
  }
}
exit $testExitCode

