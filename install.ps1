<#
.SYNOPSIS
  安装 dsh-close-dialog：把启动器复制到本地目录，并把桌面快捷方式改成经 run-hidden.vbs 启动。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExePath "C:\Program Files\DeepSeek Harness\DeepSeek Harness.exe"
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$Dest = (Join-Path $env:LOCALAPPDATA 'dsh-close-dialog'),
  [string]$ExePath,
  [switch]$NoShortcut,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$files = @('hook-inject.js', 'launch.js', 'run-hidden.vbs')

Write-Host "源目录: $source"
Write-Host "安装到: $Dest"
if ($ExePath) { Write-Host "客户端: $ExePath" }

foreach ($f in $files) {
  $p = Join-Path $source $f
  if (-not (Test-Path -LiteralPath $p)) { throw "缺少文件: $p" }
}
if ($ExePath -and -not (Test-Path -LiteralPath $ExePath)) { throw "找不到客户端 exe: $ExePath" }

if ($DryRun) {
  Write-Host ''
  Write-Host '[DryRun] 将执行：'
  Write-Host "  复制 $($files -join ', ') -> $Dest"
  if ($ExePath) { Write-Host "  写入 exe-path.txt = $ExePath" }
  if (-not $NoShortcut) { Write-Host '  备份并改写桌面 DeepSeek Harness.lnk' }
  return
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
foreach ($f in $files) {
  Copy-Item -LiteralPath (Join-Path $source $f) -Destination (Join-Path $Dest $f) -Force
  Write-Host "已复制 $f"
}

if ($ExePath) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $Dest 'exe-path.txt'), $ExePath, $utf8)
  Write-Host '已写入 exe-path.txt'
}

if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnkPath = Join-Path $desktop 'DeepSeek Harness.lnk'
  if (-not (Test-Path -LiteralPath $lnkPath)) {
    Write-Warning "桌面没有找到 DeepSeek Harness.lnk，跳过快捷方式；请手动指定目标为 wscript.exe + run-hidden.vbs"
  } else {
    $shell = New-Object -ComObject WScript.Shell
    $old = $shell.CreateShortcut($lnkPath)
    $iconSource = $old.TargetPath
    $backup = Join-Path $desktop 'DeepSeek Harness.lnk.bak'
    if (Test-Path -LiteralPath $backup) {
      $backup = Join-Path $desktop ('DeepSeek Harness.lnk.' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak')
    }
    Copy-Item -LiteralPath $lnkPath -Destination $backup -Force
    Write-Host "已备份快捷方式: $backup"

    $vbs = Join-Path $Dest 'run-hidden.vbs'
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = 'C:\Windows\System32\wscript.exe'
    $lnk.Arguments = '"' + $vbs + '"'
    $lnk.WorkingDirectory = $Dest
    if ($iconSource -like '*.exe' -and (Test-Path -LiteralPath $iconSource)) {
      $lnk.IconLocation = $iconSource + ',0'
    }
    $lnk.Save()
    Write-Host '已把桌面快捷方式改为经 run-hidden.vbs 启动'
  }
}

Write-Host ''
Write-Host '安装完成。请先退出正在运行的客户端，然后双击桌面快捷方式启动。'
