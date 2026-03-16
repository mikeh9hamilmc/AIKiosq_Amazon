---
description: Deploy AIKiosQ to AWS App Runner
---

// turbo-all
1. Execute the deployment automation script.
```powershell
python deploy.py
```
2. Monitor the deployment status in the AWS CLI.
```powershell
aws apprunner list-operations --service-arn (python -c "import deploy; print(deploy.SERVICE_ARN)")
```
