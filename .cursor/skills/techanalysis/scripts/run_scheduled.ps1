# Runs TechAnalysis batch job from the Robinhood project root.
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")
Set-Location $repoRoot

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    throw "Python not found on PATH."
}

$requirements = @(
    ".cursor\skills\techanalysis\requirements.txt",
    ".cursor\skills\buyskill\requirements.txt",
    ".cursor\skills\sellskill\requirements.txt"
)

foreach ($req in $requirements) {
    & $python -m pip install -q -r $req
}

$script = ".cursor\skills\techanalysis\scripts\run_technical_buy.py"
& $python $script --input stocklist.xlsx --output TechnicalSignal.xlsx
