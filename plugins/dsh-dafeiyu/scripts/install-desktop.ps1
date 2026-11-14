#Requires -Version 5.1
<#
.SYNOPSIS
  把 dsh-dafeiyu（大肥鱼）安装到 DeepSeek Harness 的 Desktop profile。

.DESCRIPTION
  - 复制插件到 <DSH_HOME>\profiles\desktop\plugins\dsh-dafeiyu
  - 在 desktop 的 cordis.patch.yml 中幂等追加一条 insert（带标记块，先备份）
  - -Uninstall 时移除标记块与插件目录

  需要普通 PowerShell 运行（DSH 沙箱之外的写权限）。安装后重启 DeepSeek Harness。
#>
param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME -and $env:DSH_HOME.Trim()) { $env:DSH_HOME.Trim() } else { Join-Path $HOME '.dsh' }
$profileDir = Join-Path $dshHome 'profiles\desktop'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$destDir = Join-Path $profileDir 'plugins\dsh-dafeiyu'
$markerStart = '# >>> dsh-dafeiyu'
$markerEnd = '# <<< dsh-dafeiyu'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Read-Patch {
  if (Test-Path -LiteralPath $patchPath) { return [System.IO.File]::ReadAllText($patchPath) }
  return ''
}

function Backup-Patch {
  if (Test-Path -LiteralPath $patchPath) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak-$stamp" -Force
    Write-Host "已备份 patch: $patchPath.bak-$stamp"
  }
}

function Remove-Block([string]$Text) {
  $pattern = "(?s)\r?\n?# >>> dsh-dafeiyu.*?# <<< dsh-dafeiyu\r?\n?"
  [regex]::Replace($Text, $pattern, "")
}

if (-not (Test-Path -LiteralPath $profileDir)) {
  throw "找不到 Desktop profile：$profileDir`n请先启动一次 DeepSeek Harness Desktop，或设置 DSH_HOME。"
}

if ($Uninstall) {
  if (Test-Path -LiteralPath $patchPath) {
    Backup-Patch
    $text = Read-Patch
    $next = Remove-Block($text).TrimEnd()
    if (-not $next) { $next = '[]' }
    Write-Utf8 $patchPath ($next + "`n")
    Write-Host "已从 patch 移除 dsh-dafeiyu。"
  }
  if (Test-Path -LiteralPath $destDir) {
    Remove-Item -LiteralPath $destDir -Recurse -Force
    Write-Host "已删除 $destDir"
  }
  Write-Host "重启 DeepSeek Harness 后生效。"
  exit 0
}

# 1. 复制插件（先清空目标，避免残留旧文件）
if (Test-Path -LiteralPath $destDir) { Remove-Item -LiteralPath $destDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destDir) | Out-Null
Copy-Item -LiteralPath $pluginRoot -Destination $destDir -Recurse -Force
Write-Host "已复制插件到 $destDir"

# 2. 生成 patch 块
$entryPath = (Join-Path $destDir 'lib\index.js') -replace '\\', '/'
$entryPath = $entryPath -replace "'", "''"
$block = @"
$markerStart
- insert:
    - id: dafeiyu
      name: '$entryPath'
      config:
        qq:
          enabled: false
$markerEnd
"@

# 3. 幂等写入：已有标记块则替换；空列表 [] 则替换；否则追加
$text = Read-Patch
$hadBlock = $text -match '(?s)# >>> dsh-dafeiyu.*?# <<< dsh-dafeiyu'
if ($hadBlock) {
  $next = [regex]::Replace($text, '(?s)# >>> dsh-dafeiyu.*?# <<< dsh-dafeiyu', $block)
} else {
  $trimmed = $text.TrimEnd()
  if ($trimmed -match '(?s)^(.*)\[\]\s*$') {
    $next = $Matches[1] + $block + "`n"
  } else {
    $next = $trimmed + "`n`n" + $block + "`n"
  }
}

if ($text -ne $next) {
  Backup-Patch
  Write-Utf8 $patchPath $next
  Write-Host "已写入 patch: $patchPath"
} else {
  Write-Host "patch 已是最新，无需修改。"
}

Write-Host ""
Write-Host "完成。退出并重新打开 DeepSeek Harness 后生效。"
Write-Host "QQ 默认关闭；要开启自动回复，编辑："
Write-Host "  $patchPath"
Write-Host "把 qq.enabled / qq.autoReply.enabled 改为 true，并填 wsUrl 与白名单。"
