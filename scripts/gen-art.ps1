<#
.SYNOPSIS
  用 Grok CLI 批次生成塔防美術（讀 ../art-config.json 的 groups）。
.PARAMETER Only  只生成指定 id（逗號分隔）
.PARAMETER Group 只生成某組（towers/enemies/skills）
.PARAMETER DryRun 只預覽提示詞
.EXAMPLE
  .\gen-art.ps1
  .\gen-art.ps1 -Group towers
  .\gen-art.ps1 -Only boss -DryRun
#>
param([string[]]$Only, [string]$Group, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillDir  = Split-Path -Parent $ScriptDir
$cfg = [System.IO.File]::ReadAllText((Join-Path $SkillDir 'art-config.json'), [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
$Grok = Join-Path $env:USERPROFILE '.grok\bin\grok.exe'
if (-not (Test-Path $Grok)) { $c = Get-Command grok -ErrorAction SilentlyContinue; if ($c) { $Grok = $c.Source } else { Write-Error 'grok 未安裝'; exit 1 } }

$jobs = @()
foreach ($g in $cfg.groups.PSObject.Properties) {
  if ($Group -and $g.Name -ne $Group) { continue }
  $outDir = Join-Path $SkillDir (Join-Path $cfg.outputDir $g.Name)
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  foreach ($item in $g.Value) {
    if ($Only -and $Only -notcontains $item.id) { continue }
    $jobs += [pscustomobject]@{ group=$g.Name; id=$item.id; prompt=$item.prompt; out=(Join-Path $outDir ("{0}.png" -f $item.id)) }
  }
}
Write-Host "後端: Grok | 將生成 $($jobs.Count) 張" -ForegroundColor Cyan
if ($DryRun) { Write-Host "(DryRun)" -ForegroundColor Yellow }
foreach ($j in $jobs) {
  $prompt = "Use the generate_image tool to create $($j.prompt). $($cfg.styleSuffix) Save the PNG to `"$($j.out)`"."
  Write-Host "[$($j.group)/$($j.id)]" -ForegroundColor Green
  if ($DryRun) { Write-Host "  $prompt" -ForegroundColor DarkGray; continue }
  try { & $Grok -p $prompt --always-approve 2>&1 | Out-Null; if (Test-Path $j.out) { Write-Host "  done" -ForegroundColor Green } else { Write-Host "  MISSING" -ForegroundColor Yellow } }
  catch { Write-Host "  fail: $($_.Exception.Message)" -ForegroundColor Red }
}
Write-Host "ART_DONE" -ForegroundColor Cyan
