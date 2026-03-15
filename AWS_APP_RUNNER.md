# Deploying AIKiosQ to AWS App Runner

This guide provides the CLI commands to deploy the AIKiosQ application to AWS App Runner.

## Prerequisites

- **AWS CLI** installed and configured (see below).
- **Docker** installed and running.
- AWS Permissions: `AmazonEC2ContainerRegistryFullAccess`, `AWSAppRunnerFullAccess`.

### Installing AWS CLI (Windows)

Choose one of the following methods:

**Option 1: Windows Package Manager (winget)**
Run this in PowerShell:
```powershell
winget install Amazon.AWSCLI
```

**Option 2: MSI Installer (Manual)**
1. Download the [AWS CLI MSI Installer for Windows](https://awscli.amazonaws.com/AWSCLIV2.msi).
2. Run the downloaded file and follow the on-screen instructions.

**After installation:**
- Close and reopen your terminal/PowerShell window.
- Verify by running `aws --version`.


## 0. Create App Runner Access Role

App Runner requires an IAM role to pull images from your private ECR repository.

1. **Create the trust policy file** (`trust-policy.json`):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "build.apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

2. **Create the role and attach permissions**:
```powershell
# Create the role
aws iam create-role `
  --role-name AppRunnerECRAccessRole `
  --assume-role-policy-document file://trust-policy.json

# Attach the ECR access policy
aws iam attach-role-policy `
  --role-name AppRunnerECRAccessRole `
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

## 0.2 Create App Runner Instance Role (Secure)

This role allows your application code (Sparky) to talk to Amazon Bedrock securely without using secret keys.

1. **Create the trust policy file** (`instance-trust-policy.json`):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "tasks.apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

2. **Create the role and attach permissions**:
```powershell
# Create the role
aws iam create-role `
  --role-name AppRunnerBedrockInstanceRole `
  --assume-role-policy-document file://instance-trust-policy.json

# Attach Bedrock permissions
aws iam attach-role-policy `
  --role-name AppRunnerBedrockInstanceRole `
  --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess
```
```

## 1. Create ECR Repository

Create a repository to store your Docker image:

```bash
aws ecr create-repository --repository-name aikiosq-app-runner --region us-east-1
```

## 2. Authenticate Docker to ECR

Login to your registry (replace `REDACTED_AWS_ACCOUNT_ID` with your AWS Account ID):

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin REDACTED_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
```

## 3. Build, Tag, and Push Image

```bash
# Build the image
docker build -t aikiosq-app-runner .

# Tag the image
docker tag aikiosq-app-runner:latest REDACTED_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/aikiosq-app-runner:latest

# Push the image
docker push REDACTED_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/aikiosq-app-runner:latest
```

## 4. Create App Runner Service

Create the service using the pushed image. 

> [!NOTE]
> Environment variables for AWS credentials should be passed here or configured in the App Runner console for Nova Sonic to work.

```bash
aws apprunner create-service `
  --service-name aikiosq-service `
  --source-configuration '{
    \"ImageRepository\": {
      \"ImageIdentifier\": \"REDACTED_AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/aikiosq-app-runner:latest\",
      \"ImageConfiguration\": {
        \"Port\": \"8080\",
        \"RuntimeEnvironmentVariables\": {
          \"VITE_AWS_REGION\": \"us-east-1\"
        }
      },
      \"ImageRepositoryType\": \"ECR\"
    },
    \"AutoDeploymentsEnabled\": true,
    \"AuthenticationConfiguration\": {
      \"AccessRoleArn\": \"arn:aws:iam::REDACTED_AWS_ACCOUNT_ID:role/AppRunnerECRAccessRole\"
    }
  }' `
  --instance-configuration '{
    \"InstanceRoleArn\": \"arn:aws:iam::REDACTED_AWS_ACCOUNT_ID:role/AppRunnerBedrockInstanceRole\"
  }' `
  --region us-east-1
```

## 5. Environment Variables & IAM

For Sparky to communicate with Bedrock, you must ensure the App Runner service has an **Instance Role** with `AmazonBedrockFullAccess` OR pass your access keys as environment variables (not recommended for production).

Example of adding variables later:

```bash
aws apprunner update-service `
  --service-arn <service-arn> `
  --source-configuration '{
    \"ImageRepository\": {
      \"ImageConfiguration\": {
        \"RuntimeEnvironmentVariables\": {
          \"VITE_AWS_ACCESS_KEY_ID\": \"YOUR_AWS_ACCESS_KEY\",
          \"VITE_AWS_SECRET_ACCESS_KEY\": \"YOUR_AWS_SECRET_KEY\"
        }
      }
    }
  }'
```

