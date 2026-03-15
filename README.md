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
Create a `.env.local` file in the root directory and add your AWS credentials:
```bash
VITE_AWS_ACCESS_KEY_ID=your_access_key
VITE_AWS_SECRET_ACCESS_KEY=your_secret_key
VITE_AWS_REGION=us-east-1
```
> [!NOTE]
> In production (App Runner), the server uses an IAM Instance Role, and these keys are not required.

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
