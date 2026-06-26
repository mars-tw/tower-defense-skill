<#
.SYNOPSIS
  用 OpenAI 生成地圖磚塊與攻擊投射物美術。需環境變數 OPENAI_API_KEY。
.PARAMETER Only  只生成指定 id
.PARAMETER DryRun 只印提示詞
#>
param([string[]]$Only, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillDir  = Split-Path -Parent $ScriptDir

# 地圖磚塊（可平鋪，正方）+ 裝飾物 + 投射物
$items = @(
  # 地圖磚塊：grass 草地數種變化、path 路徑
  @{ grp='tiles'; id='grass1';  p='a seamless tileable top-down grass texture tile, lush green, pixel-art game style, subtle variation' },
  @{ grp='tiles'; id='grass2';  p='a seamless tileable top-down grass texture with small flowers, green, pixel-art game style' },
  @{ grp='tiles'; id='grass3';  p='a seamless tileable top-down darker grass texture with dirt patches, pixel-art game style' },
  @{ grp='tiles'; id='path';    p='a seamless tileable top-down dirt road path texture, brown earthy, pixel-art game style' },
  # 裝飾物（透明背景）
  @{ grp='tiles'; id='rock';    p='a small grey boulder rock, top-down game decoration, pixel-art, transparent background' },
  @{ grp='tiles'; id='bush';    p='a small green bush shrub, top-down game decoration, pixel-art, transparent background' },
  @{ grp='tiles'; id='tree';    p='a small pine tree, top-down game decoration, pixel-art, transparent background' },
  # 攻擊投射物（透明背景，小巧）
  @{ grp='projectiles'; id='arrow';  p='a single sharp wooden arrow pointing right, pixel-art game projectile, transparent background, no background' },
  @{ grp='projectiles'; id='cannonball'; p='a black iron cannonball with motion, pixel-art game projectile, transparent background, no background' },
  @{ grp='projectiles'; id='iceshard';   p='a sharp blue ice crystal shard, pixel-art game projectile, glowing, transparent background, no background' },
  @{ grp='projectiles'; id='lightning';  p='a crackling yellow lightning bolt orb, pixel-art game projectile, electric, transparent background, no background' },
  @{ grp='projectiles'; id='fireball';   p='a blazing orange fireball, pixel-art game projectile, fire, transparent background, no background' }
)

$ApiKey = $env:OPENAI_API_KEY
if (-not $DryRun -and -not $ApiKey) { Write-Error "未設定 OPENAI_API_KEY"; exit 1 }
$targets = if ($Only) { $items | Where-Object { $Only -contains $_.id } } else { $items }
Write-Host "將生成 $($targets.Count) 張" -ForegroundColor Cyan

foreach ($it in $targets) {
  $outDir = Join-Path $SkillDir "assets\$($it.grp)"
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  $out = Join-Path $outDir "$($it.id).png"
  $style = "Clean game asset, vibrant colors, square composition, no text, no labels."
  $prompt = "$($it.p). $style"
  Write-Host "[$($it.grp)/$($it.id)]" -ForegroundColor Green
  if ($DryRun) { Write-Host "  $prompt" -ForegroundColor DarkGray; continue }
  try {
    $body = @{ model='gpt-image-1'; prompt=$prompt; size='1024x1024'; n=1 } | ConvertTo-Json
    $headers = @{ Authorization="Bearer $ApiKey"; 'Content-Type'='application/json' }
    $resp = Invoke-RestMethod -Uri 'https://api.openai.com/v1/images/generations' -Method Post -Headers $headers -Body $body -TimeoutSec 180
    $item = $resp.data[0]
    if ($item.b64_json) { [System.IO.File]::WriteAllBytes($out, [Convert]::FromBase64String($item.b64_json)) }
    elseif ($item.url) { Invoke-WebRequest -Uri $item.url -OutFile $out -UseBasicParsing }
    else { throw "無資料" }
    Write-Host "  done" -ForegroundColor Green
  } catch { Write-Host "  fail: $($_.Exception.Message)" -ForegroundColor Red }
}
Write-Host "TILES_DONE" -ForegroundColor Cyan
