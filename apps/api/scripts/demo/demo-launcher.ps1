# ZOAURO demo launcher (owner, 2026-10-22): run the demo without VS Code. Used by Start-ZOAURO-Demo.cmd and
# Stop-ZOAURO-Demo.cmd in this folder. Runs the FROZEN demo build (pnpm --filter @zoauro/api demo:build) against
# zoauro_demo with apps/api/.env.demo; it never builds, resets or seeds, and never touches the dev servers (:4000, :3000).
#
#   demo-launcher.ps1 start          Docker + infrastructure, demo API + worker + web, warm-up, browser
#   demo-launcher.ps1 stop [/all]    ends only the demo processes; /all also stops the four infrastructure containers
#
# Logs: <demo build>\logs\api.log, worker.log, web.log (outside the repository). The API logs error classes only, never
# request bodies or personal data.

param(
  [Parameter(Position = 0)][ValidateSet('start', 'stop')][string]$Command = 'start',
  [Parameter(Position = 1)][string]$Option = ''
)

$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$ApiDir = Join-Path $Repo 'apps\api'
$EnvDemo = Join-Path $ApiDir '.env.demo'
$Build = Join-Path (Split-Path $Repo -Parent) 'zoauro-demo-build'
$Logs = Join-Path $Build 'logs'
$ApiPort = 4100
$WebPort = 3100
$WebUrl = "http://127.0.0.1:$WebPort"

function Step([string]$Text) { Write-Host "  - $Text" }

# Docker writes progress to stderr; under 'Stop', Windows PowerShell 5.1 turns that into a terminating error.
# Run it with 'Continue' (local to this function) and judge it by $LASTEXITCODE only.
function Invoke-Docker([string]$LogFile, [string[]]$DockerArgs) {
  $ErrorActionPreference = 'Continue'
  if ($LogFile) { & docker @DockerArgs *> $LogFile } else { & docker @DockerArgs *> $null }
}
function Fail([string]$Text) {
  Write-Host ''
  Write-Host "DEMO NOT READY: $Text" -ForegroundColor Red
  exit 1
}

# The demo's own processes: the built API/worker on .env.demo, `next start` on 3100, and the pnpm/tsx wrappers.
function Get-DemoProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $c = $_.CommandLine
    $c -and (
      ($c -like '*.env.demo*dist/server.js*') -or ($c -like '*.env.demo*dist/worker.js*') -or
      ($c -like "*next*start -p $WebPort*") -or ($c -like '*demo.ts api*') -or
      ($c -like '*demo.ts web*') -or ($c -like '*demo.ts worker*')
    )
  }
}

function Get-PortOwner([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
}

function Wait-Http([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0 -ErrorAction Stop
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { return $true }
    } catch {
      $resp = $_.Exception.Response
      if ($resp -and [int]$resp.StatusCode -ge 300 -and [int]$resp.StatusCode -lt 400) { return $true }
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Stop-Demo([switch]$All) {
  Write-Host 'Stopping the ZOAURO demo'
  $mine = @(Get-DemoProcesses)
  foreach ($p in $mine) {
    Step "ending process $($p.ProcessId)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($mine.Count -eq 0) { Step 'no demo process was running' }
  if ($All) {
    Step 'stopping postgres, redis, minio, mailpit (Docker keeps running)'
    Push-Location $Repo
    try { Invoke-Docker '' @('compose', '-f', 'docker-compose.dev.yml', 'stop', 'postgres', 'redis', 'minio', 'mailpit') } finally { Pop-Location }
  }
  if (Test-Path $Logs) { Add-Content (Join-Path $Logs 'starts.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') stop ($($mine.Count) processes)" }
  Write-Host 'Demo stopped.' -ForegroundColor Green
}

function Start-Demo {
  Write-Host 'Starting the ZOAURO demo'

  # 0. what the launcher needs
  if (-not (Test-Path (Join-Path $Build 'DEMO_BUILD.json'))) {
    Fail "no demo build at $Build. Run: pnpm --filter @zoauro/api demo:build"
  }
  if (-not (Test-Path $EnvDemo)) { Fail 'apps\api\.env.demo is missing. Run: pnpm --filter @zoauro/api demo:env' }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Fail 'Node.js is not on the PATH' }
  $commit = (Get-Content (Join-Path $Build 'DEMO_BUILD.json') -Raw | ConvertFrom-Json).commit
  New-Item -ItemType Directory -Force -Path $Logs | Out-Null

  # 1. Docker
  Invoke-Docker '' @('info')
  if ($LASTEXITCODE -ne 0) {
    Step 'starting Docker Desktop'
    $exe = @(
      (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
      (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) { Fail 'Docker Desktop is not installed where expected; start it by hand and run again' }
    Start-Process $exe | Out-Null
    $deadline = (Get-Date).AddSeconds(240)
    do {
      Start-Sleep -Seconds 5
      Invoke-Docker '' @('info')
    } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)
    if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop did not start within 4 minutes' }
  }
  Step 'Docker is running'

  # 2. infrastructure
  Step 'starting postgres, redis, minio, mailpit'
  Push-Location $Repo
  try {
    Invoke-Docker (Join-Path $Logs 'infra.log') @('compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait', 'postgres', 'redis', 'minio', 'mailpit')
    if ($LASTEXITCODE -ne 0) { Fail "the infrastructure containers did not become healthy (see $Logs\infra.log)" }
  } finally { Pop-Location }

  # 3. the ports must be free or already ours
  foreach ($port in @($ApiPort, $WebPort)) {
    $owner = Get-PortOwner $port
    if ($owner -and -not (@(Get-DemoProcesses) | Where-Object { $_.ProcessId -eq $owner.ProcessId })) {
      Fail "port $port is used by another program (process $($owner.ProcessId)); close it and run again"
    }
  }
  $running = @(Get-DemoProcesses)
  if ($running.Count -gt 0 -and (Get-PortOwner $ApiPort) -and (Get-PortOwner $WebPort) -and
      (Wait-Http "http://127.0.0.1:$ApiPort/api/ready" 5) -and (Wait-Http "$WebUrl/login" 5)) {
    # a second double-click: nothing new is started
    Start-Process "$WebUrl/login"
    Write-Host ''
    Write-Host "Demo already running: $WebUrl (build $commit). Nothing new was started." -ForegroundColor Green
    return
  }
  if ($running.Count -gt 0) {
    Step 'part of an earlier demo is still running: restarting it'
    $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }

  # 4. API, worker and web, each in its own minimized window, logs to files. The previous run's logs are kept as
  #    *.prev.log (why did it stop?), and each process gets a heap cap so none can take this laptop's last memory.
  $apiDir = Join-Path $Build 'apps\api'
  $webDir = Join-Path $Build 'apps\web'
  foreach ($name in 'api', 'api.err', 'worker', 'worker.err', 'web', 'web.err') {
    $log = Join-Path $Logs "$name.log"
    if (Test-Path $log) { Move-Item -Force $log (Join-Path $Logs "$name.prev.log") }
  }
  Add-Content (Join-Path $Logs 'starts.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') start, build $commit"
  Step 'starting the demo API (:4100) and worker'
  Start-Process -FilePath $node -ArgumentList '--max-old-space-size=768', "`"--env-file=$EnvDemo`"", 'dist/server.js' -WorkingDirectory $apiDir `
    -WindowStyle Minimized -RedirectStandardOutput (Join-Path $Logs 'api.log') -RedirectStandardError (Join-Path $Logs 'api.err.log') | Out-Null
  Start-Process -FilePath $node -ArgumentList '--max-old-space-size=384', "`"--env-file=$EnvDemo`"", 'dist/worker.js' -WorkingDirectory $apiDir `
    -WindowStyle Minimized -RedirectStandardOutput (Join-Path $Logs 'worker.log') -RedirectStandardError (Join-Path $Logs 'worker.err.log') | Out-Null
  Step 'starting the demo web (:3100)'
  $env:WEB_INTERNAL_API_URL = "http://127.0.0.1:$ApiPort"
  $env:NEXT_TELEMETRY_DISABLED = '1'
  $next = Join-Path $webDir 'node_modules\next\dist\bin\next'
  Start-Process -FilePath $node -ArgumentList '--max-old-space-size=1024', "`"$next`"", 'start', '-p', "$WebPort", '-H', '127.0.0.1' -WorkingDirectory $webDir `
    -WindowStyle Minimized -RedirectStandardOutput (Join-Path $Logs 'web.log') -RedirectStandardError (Join-Path $Logs 'web.err.log') | Out-Null

  # 5. ready checks
  if (-not (Wait-Http "http://127.0.0.1:$ApiPort/api/ready" 120)) { Fail "the demo API did not become ready (see $Logs\api.err.log)" }
  Step 'API ready'
  if (-not (Wait-Http "$WebUrl/login" 120)) { Fail "the demo web did not answer (see $Logs\web.err.log)" }
  Step 'web ready'

  # 6. warm the main pages and the API once, so the first click during the demo is fast
  Step 'warming the main pages'
  $pages = @('/login', '/super-admin/dashboard', '/super-admin/orders', '/super-admin/orders/overview', '/super-admin/restaurants',
    '/super-admin/homemakers', '/super-admin/delivery-partners', '/super-admin/customers', '/super-admin/refunds',
    '/super-admin/vendor-onboarding', '/super-admin/menu-items', '/super-admin/hotels', '/super-admin/support',
    '/super-admin/zones', '/super-admin/settings/platform', '/zone/dashboard', '/zone/orders', '/zone/restaurants')
  foreach ($p in $pages) {
    try { Invoke-WebRequest -Uri "$WebUrl$p" -UseBasicParsing -TimeoutSec 30 -MaximumRedirection 0 -ErrorAction SilentlyContinue | Out-Null } catch { }
  }
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/v1/openapi.json" -UseBasicParsing -TimeoutSec 30 | Out-Null } catch { }

  # 7. browser
  Start-Process "$WebUrl/login"
  Start-Process 'http://127.0.0.1:8025'

  Write-Host ''
  Write-Host "Demo ready: $WebUrl (build $commit). 2-step codes: your inbox or Mailpit http://127.0.0.1:8025." -ForegroundColor Green
}

if ($Command -eq 'stop') { Stop-Demo -All:($Option -eq '/all' -or $Option -eq '-all') } else { Start-Demo }
