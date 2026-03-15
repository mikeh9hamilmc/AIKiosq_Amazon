# AIKiosQ Local Docker Test Script (Windows)

Write-Host "Starting Local Docker Test Preparation..."

$AWS_DIR = "$HOME/.aws"
$ACCESS_KEY = $null
$SECRET_KEY = $null
$SESSION_TOKEN = $null

# 1. Check for custom 'login' type credentials
$CACHE_DIR = "$AWS_DIR/login/cache"
if (Test-Path $CACHE_DIR) {
    Write-Host "Found custom login cache. Extracting temporary credentials..."
    $cacheFile = Get-ChildItem -Path "$CACHE_DIR/*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($cacheFile) {
        try {
            # Read file as raw string and then convert
            $jsonContent = Get-Content $cacheFile.FullName -Raw
            $json = $jsonContent | ConvertFrom-Json
            if ($json.accessToken) {
                $ACCESS_KEY = $json.accessToken.accessKeyId
                $SECRET_KEY = $json.accessToken.secretAccessKey
                $SESSION_TOKEN = $json.accessToken.sessionToken
                Write-Host "Success: Extracted credentials from cache."
            }
        } catch {
            Write-Host "Warning: Failed to parse cache file."
        }
    }
}

# 2. If not found in cache, try standard environment variables
if (-not $ACCESS_KEY) {
    $ACCESS_KEY = $env:AWS_ACCESS_KEY_ID
    $SECRET_KEY = $env:AWS_SECRET_ACCESS_KEY
    $SESSION_TOKEN = $env:AWS_SESSION_TOKEN
}

# 3. Determine if we have enough to run
if (-not $ACCESS_KEY) {
    Write-Host "Error: No AWS credentials found. Please run your AWS login command first." -ForegroundColor Red
    exit 1
}

Write-Host "Starting Local Docker Test..."

$DOCKER_ARGS = @(
    "run", "-it", "--rm",
    "-p", "8080:8080",
    "-e", "VITE_AWS_REGION=us-east-1",
    "-e", "AWS_ACCESS_KEY_ID=$ACCESS_KEY",
    "-e", "AWS_SECRET_ACCESS_KEY=$SECRET_KEY"
)

if ($SESSION_TOKEN) {
    $DOCKER_ARGS += "-e"
    $DOCKER_ARGS += "AWS_SESSION_TOKEN=$SESSION_TOKEN"
}

$DOCKER_ARGS += "aikiosq-app-runner"

# Run docker with the argument array
& docker @DOCKER_ARGS

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker run failed." -ForegroundColor Red
}
