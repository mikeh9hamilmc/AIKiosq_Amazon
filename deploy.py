import subprocess
import sys
import os

def load_env():
    """Simple parser to load .env.local without external dependencies."""
    env_file = ".env.local"
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key.strip()] = value.strip()

# Load environment variables before configuration constants
load_env()

# Configuration (from .env.local or defaults)
AWS_REGION = os.getenv("VITE_AWS_REGION", "us-east-1")
AWS_ACCOUNT_ID = os.getenv("AWS_ACCOUNT_ID")
SERVICE_ARN = os.getenv("AWS_APP_RUNNER_SERVICE_ARN")
IMAGE_NAME = os.getenv("ECR_REPOSITORY_NAME", "aikiosq-app-runner")

# Derived Configuration
ECR_REGISTRY = f"{AWS_ACCOUNT_ID}.dkr.ecr.{AWS_REGION}.amazonaws.com"
ECR_URL = f"{ECR_REGISTRY}/{IMAGE_NAME}:latest"

# Validation
REQUIRED_VARS = ["AWS_ACCOUNT_ID", "AWS_APP_RUNNER_SERVICE_ARN"]
missing = [var for var in REQUIRED_VARS if not os.getenv(var)]
if missing:
    print(f"❌ Error: Missing required environment variables in .env.local: {', '.join(missing)}")
    print("Please copy .env.template to .env.local and fill in your AWS details.")
    sys.exit(1)

SERVICE_NAME = "aikiosq-service" # Display name

def run_command(command, description):
    print(f"\n🚀 {description}...")
    print(f"Running: {command}")
    try:
        result = subprocess.run(command, shell=True, check=True, text=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error during {description}:")
        print(e)
        return False

def ecr_login():
    """Authenticate Docker with ECR using the current AWS session."""
    print("\n🔑 Logging Docker into ECR...")
    # Get ECR password and pipe to docker login
    try:
        # Step 1: Get the ECR password
        token_result = subprocess.run(
            f"aws ecr get-login-password --region {AWS_REGION}",
            shell=True, check=True, capture_output=True, text=True
        )
        ecr_password = token_result.stdout.strip()

        # Step 2: Docker login
        login_result = subprocess.run(
            f"docker login --username AWS --password-stdin {ECR_REGISTRY}",
            shell=True, check=True, input=ecr_password, capture_output=True, text=True
        )
        print("✅ Docker ECR login successful.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ ECR login failed: {e.stderr or e}")
        print("   Hint: Make sure your AWS session is valid. Run 'aws login' first.")
        return False

def main():
    print("=== AIKiosQ AWS Deployment Automation ===")

    # 1. Build
    if not run_command(f"docker build -t {IMAGE_NAME} .", "Building Docker image"):
        sys.exit(1)

    # 2. Tag
    if not run_command(f"docker tag {IMAGE_NAME}:latest {ECR_URL}", "Tagging image for ECR"):
        sys.exit(1)

    # 3. ECR Login (fresh token required for each push session)
    if not ecr_login():
        sys.exit(1)

    # 4. Push
    if not run_command(f"docker push {ECR_URL}", "Pushing image to ECR"):
        sys.exit(1)

    # 5. Trigger Deployment
    if not run_command(f"aws apprunner start-deployment --service-arn {SERVICE_ARN} --no-cli-pager", "Triggering App Runner Deployment"):
        print("\n⚠️ Note: Deployment trigger might fail if another operation is in progress, but the push was successful.")
        print("Auto-deployments are enabled, so it should update automatically regardless.")

    print("\n✅ Deployment process initiated successfully!")
    print(f"Monitor status: aws apprunner describe-service --service-arn {SERVICE_ARN} --no-cli-pager")

if __name__ == "__main__":
    main()
