<#
.SYNOPSIS
  用 OpenAI 為英雄生成 2x2 四方向設定集並自動裁切成 down/up/left/right。
.DESCRIPTION
  每個英雄生一張「同一角色四方向」設定集，再用 System.Drawing 裁成 4 張方向圖，
  存到 assets/heroes/<id>/。需環境變數 OPENAI_API_KEY（不寫進檔案）。
.PARAMETER Only  只生成指定英雄 id（逗號分隔）
.PARAMETER DryRun 只印提示詞不呼叫 API
.EXAMPLE
  $env:OPENAI_API_KEY = "sk-..."
  .\gen-heroes.ps1
  .\gen-heroes.ps1 -Only mage,valkyrie
#>
param([string[]]$Only, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillDir  = Split-Path -Parent $ScriptDir
$heroesDir = Join-Path $SkillDir 'assets\heroes'

# 英雄外觀描述（與 heroes.js 的 id 對應）
$heroes = @(
  @{ id='knight';  look='a chibi paladin knight in blue and silver armor, blonde hair, holding a silver sword' },
  @{ id='archer';  look='a chibi elf ranger in green leather armor, holding a wooden bow, brown hair' },
  @{ id='mage';    look='a chibi fire mage in red and orange robes, holding a glowing fire staff, white beard' },
  @{ id='iceMage'; look='a chibi ice mage in blue and white robes, holding a frost staff, silver hair' },
  @{ id='valkyrie';look='a chibi valkyrie warrior in golden winged armor, holding a lightning spear, white hair' },
  @{ id='cleric';  look='a chibi cleric priest in white and gold robes, holding a holy staff, gentle face' }
)

$style = "A pixel-art RPG character sprite sheet on a pure white background, arranged in a clean 2x2 grid with generous spacing. The SAME character shown in FOUR directions: top-left facing down/front, top-right facing up/back, bottom-left left side profile, bottom-right right side profile. Identical consistent character across all four, full body, flat white background, clear separation, no text, no labels, no grid lines."

$ApiKey = $env:OPENAI_API_KEY
if (-not $DryRun -and -not $ApiKey) { Write-Error "未設定 OPENAI_API_KEY"; exit 1 }

$targets = if ($Only) { $heroes | Where-Object { $Only -contains $_.id } } else { $heroes }
Write-Host "將生成 $($targets.Count) 個英雄的四方向設定集" -ForegroundColor Cyan

function Split-Sheet($sheetPath, $outDir) {
  $img = [System.Drawing.Image]::FromFile($sheetPath)
  $cw = [int]($img.Width / 2); $ch = [int]($img.Height / 2)
  $cells = @(@{id='down';x=0;y=0},@{id='up';x=$cw;y=0},@{id='left';x=0;y=$ch},@{id='right';x=$cw;y=$ch})
  foreach ($c in $cells) {
    $bmp = New-Object System.Drawing.Bitmap($cw, $ch)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0,0,$cw,$ch)), (New-Object System.Drawing.Rectangle($c.x,$c.y,$cw,$ch)), [System.Drawing.GraphicsUnit]::Pixel)
    $bmp.Save((Join-Path $outDir "$($c.id).png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  }
  $img.Dispose()
}

foreach ($h in $targets) {
  $outDir = Join-Path $heroesDir $h.id
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  $sheet = Join-Path $outDir "_sheet.png"
  $prompt = "$($h.look). $style"
  Write-Host "[$($h.id)]" -ForegroundColor Green
  if ($DryRun) { Write-Host "  $prompt" -ForegroundColor DarkGray; continue }
  try {
    $body = @{ model='gpt-image-1'; prompt=$prompt; size='1024x1024'; n=1 } | ConvertTo-Json
    $headers = @{ Authorization="Bearer $ApiKey"; 'Content-Type'='application/json' }
    $resp = Invoke-RestMethod -Uri 'https://api.openai.com/v1/images/generations' -Method Post -Headers $headers -Body $body -TimeoutSec 180
    $item = $resp.data[0]
    if ($item.b64_json) { [System.IO.File]::WriteAllBytes($sheet, [Convert]::FromBase64String($item.b64_json)) }
    elseif ($item.url) { Invoke-WebRequest -Uri $item.url -OutFile $sheet -UseBasicParsing }
    else { throw "無圖片資料" }
    Split-Sheet $sheet $outDir
    Remove-Item $sheet -Force
    Write-Host "  done（已裁切 4 方向）" -ForegroundColor Green
  } catch { Write-Host "  fail: $($_.Exception.Message)" -ForegroundColor Red }
}
Write-Host "HEROES_DONE" -ForegroundColor Cyan
