# AIKiosQ - Sparky's Hardware Store Kiosk

This project is a React + TypeScript kiosk application for hardware stores, powered by Amazon Bedrock (Nova Sonic and Nova Lite).

## 🚀 Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [FFmpeg](https://ffmpeg.org/) (required locally for converting audio triggers)

### 1. Installation
Install project dependencies:
```bash
npm install
```

### 2. AWS Configuration
The project requires several environment variables for AWS Bedrock access and deployment.

1. Copy the template to create your local environment file:
   ```bash
   cp .env.template .env.local
   ```
2. Open `.env.local` and fill in your AWS credentials and configuration.

> [!NOTE]
> In production (App Runner), the server uses an IAM Instance Role, and the static keys are not required, but the deployment variables (like `AWS_ACCOUNT_ID`) are still used by the deployment script.

### 3. Run the App
Start both the Vite frontend and Express backend concurrently:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the kiosk.

---

## 🧪 Testing

### Unit & Component Tests
This project uses **Vitest** for unit and component testing.
```bash
# Run tests in watch mode
npm run test

# Run tests once
npm run test:run
```

### End-to-End (E2E) Tests
We use **Playwright** for e2e testing.
```bash
# Install Playwright browsers (first-time only)
npx playwright install

# Run E2E tests
npm run test:e2e
```

---

## 📦 Deployment
Refer to [AWS_APP_RUNNER.md](AWS_APP_RUNNER.md) for instructions on how to deploy this application to AWS App Runner.
For technical details on AI behaviors and troubleshooting, see [AGENTS.md](AGENTS.md).

---

## 🤖 AI Agent Workflows
This repository includes structured workflows in `.agent/workflows/` that can be executed by AI coding assistants (like Antigravity) to automate common tasks.

- **[test.md](.agents/workflows/test.md)**: Automatically runs all unit and E2E tests to verify project stability.
- **[deploy.md](.agents/workflows/deploy.md)**: Handles the full deployment process to AWS App Runner, including building the Docker image and pushing to ECR.

To use these workflows with an agent, simply type /test or ask: *"Run the test workflow"* or *"Run the deploy workflow"*.
