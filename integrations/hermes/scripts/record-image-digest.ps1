param(
  [string]$Image = "tongzhou/hermes-agent:v0.21.7-71d34bad"
)

$ErrorActionPreference = "Stop"
$repoDigest = docker image inspect $Image --format '{{index .RepoDigests 0}}'
if (-not $repoDigest -or $repoDigest -notmatch '@sha256:[0-9a-f]{64}$') {
  throw "Image does not have a registry-backed RepoDigest. Push the reviewed image, pull it by digest, then rerun this script."
}

$lockPath = Join-Path $PSScriptRoot "..\image.lock"
$content = @(
  "HERMES_RUNTIME_IMAGE=$repoDigest"
  "HERMES_SOURCE_TAG=v0.21.7"
  "HERMES_SOURCE_COMMIT=71d34bad1045610252eda02ee79549436896e784"
) -join "`n"
[System.IO.File]::WriteAllText((Resolve-Path (Split-Path $lockPath -Parent)).Path + "\image.lock", $content + "`n")
Write-Output "Recorded $repoDigest in $lockPath"
