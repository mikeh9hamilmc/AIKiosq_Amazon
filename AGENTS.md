# AIKiosQ - Sparky's Hardware Store Kiosk (Amazon Nova Edition)

## System Overview

AIKiosQ is a React + TypeScript kiosk application for hardware stores. It uses **Amazon Bedrock** for all AI capabilities:

| Model | Purpose | Usage |
|-------|---------|-------|
| **Amazon Nova Sonic** (`amazon.nova-2-sonic-v1:0`) | Real-time Speech-to-Speech conversation | Bidirectional HTTP/2 Stream via Express+Socket.IO server |
| **Amazon Nova Lite 2** (`us.amazon.nova-2-lite-v1:0`) | Deep part analysis with image input | On-demand via `Converse API` — **proxied through Express server** |
| Mock JSON | Inventory lookup | Instant |

The AI persona is **"Sparky"** — a veteran hardware store manager with 30 years of electrician experience and a friendly, funny personality.

---

## Architecture

Nova Sonic requires HTTP/2 bidirectional streaming, which is only available server-side (Node.js). The application uses a two-process architecture:

```
Browser (React + Vite :3000)              Server (Express + Socket.IO :3001)
┌──────────────────────────┐              ┌──────────────────────────────────┐
│ App.tsx                   │   Socket.IO  │ server/index.ts                  │
│ - Motion detection        │◄───────────►│ - Session management             │
│ - Camera/mic capture      │  (polling→WS)│ - NovaSonicBidirectionalClient   │
│ - Audio playback          │              │   - Bedrock HTTP/2 stream        │
│ - UI rendering            │              │   - Tool event relay to client   │
│ - Tool execution          │   HTTP POST  │ - Nova Lite proxy endpoint       │
│                           │◄───────────►│   POST /api/analyze-part         │
│ services/                 │              │ - AWS creds: Instance Role only  │
│  novaSonicService.ts      │              │                                  │
│  (Socket.IO client)       │              │ server/novaSonicClient.ts        │
│  novaAnalysisService.ts   │              │ server/types.ts                  │
│  (fetch → /api/analyze-part)│            │                                  │
└──────────────────────────┘              └──────────────────────────────────┘
```

Vite dev server proxies `/socket.io` WebSocket connections to `:3001`.

> **App Runner note**: Socket.IO must use `transports: ["polling", "websocket"]` — App Runner's ALB does not reliably forward pure WebSocket upgrades. Polling establishes the connection first, then upgrades automatically.

---

## Application Flow

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 1. STARTUP                                                               │
 │    App mounts → loads inventory.json → user clicks ACTIVATE SENSORS      │
 │    Camera + mic permissions granted → motion detection loop starts        │
 └──────────────────────────┬───────────────────────────────────────────────┘
                            ↓
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 2. MOTION DETECTION                                                      │
 │    Downsamples video to 64x48 → compares consecutive frames              │
 │    Pixel diff > MOTION_THRESHOLD (50) counted → total > TRIGGER_SCORE    │
 │    (200) → triggers connectToNova()                                      │
 └──────────────────────────┬───────────────────────────────────────────────┘
                            ↓
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 3. NOVA SONIC SESSION                                                    │
 │    Socket.IO → server → Bedrock bidirectional stream                     │
 │    Audio: 16kHz PCM (Mic) ⇄ 24kHz PCM (Speaker)                         │
 │    Sparky greets customer automatically via System Prompt                    │
 │    Native tool calling (not text pattern matching)                        │
 └──────────────────────────┬───────────────────────────────────────────────┘
                            ↓
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 4. TOOL-DRIVEN CONVERSATION                                             │
 │    Nova Sonic dispatches native toolUse events. Client handles them:     │
 │                                                                          │
 │    analyze_part(description)                                             │
 │       │                                                                  │
 │       └─→ 1. Pause Audio                                                 │
 │           2. Countdown 3..2..1                                           │
 │           3. Client captures High-Res Snapshot (Canvas)                  │
 │           4. Send to Amazon Nova Lite 2 (Converse API)                   │
 │           5. Result: "{Part Name} \n {Instructions}"                     │
 │           6. Send toolResult back to server → Bedrock                    │
 │           7. Sparky tells customer what part it is                          │
 │           8. Sparky asks if user wants instructions                         │
 │           9. Sparky asks if user wants to check inventory                   │
 │                                                                          │
 │    check_inventory(query)                                                │
 │       │                                                                  │
 │       └─→ 1. Search inventory.json                                       │
 │           2. Display results on screen (Product Cards)                   │
 │           3. Send toolResult to Bedrock                                  │
 │           4. Sparky tells customer what's in stock                          │
 │           5. Sparky offers to show aisle location                           │
 │                                                                          │
 │    show_aisle(aisle_name)                                                │
 │       │                                                                  │
 │       └─→ 1. Display aisle sign image on screen                          │
 │           2. Send toolResult to Bedrock                                  │
 │           3. Sparky says goodbye                                            │
 │                                                                          │
 └──────────────────────────┬───────────────────────────────────────────────┘
                            ↓
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ 5. SESSION END / RESET                                                   │
 │    User walks away or inactivity timer fires (5 min)                     │
 │    → Socket.IO disconnect → server cleans up Bedrock session             │
 │    → Resets UI to "Standby" → motion detection resumes                   │
 └──────────────────────────────────────────────────────────────────────────┘
```

---

## Setup & Credentials

### AWS Credentials
Create `.env.local` in the project root:

```bash
VITE_AWS_ACCESS_KEY_ID=AKIA...
VITE_AWS_SECRET_ACCESS_KEY=...
VITE_AWS_REGION=us-east-1
```

Server reads credentials from `.env.local` via dotenv. Browser uses them for Nova Lite Converse API calls.

> **Note**: For Hackathon/Workshop accounts, add `VITE_AWS_SESSION_TOKEN` if needed.

### App Runner (Production) — IAM Instance Role

On App Runner, the service uses an **IAM Instance Role** (`AppRunnerBedrockInstanceRole`) instead of static credentials. The browser never calls AWS directly — all Bedrock calls go through the Express server which automatically uses the Instance Role.

**Required IAM permissions on the Instance Role:**
- `AmazonBedrockFullAccess`

**To update the App Runner service with the Instance Role:**
```bash
aws apprunner update-service \
  --service-arn <SERVICE_ARN> \
  --instance-configuration '{"InstanceRoleArn":"arn:aws:iam::<ACCOUNT>:role/AppRunnerBedrockInstanceRole"}'
```

> **Do NOT** set `VITE_AWS_ACCESS_KEY_ID` / `VITE_AWS_SECRET_ACCESS_KEY` when using App Runner. The `.env.local` file should have no AWS keys — the server uses the metadata service automatically.

### Running

```bash
npm install
npm run dev          # Starts both Vite (:3000) and Express server (:3001)
npm run dev:client   # Vite only
npm run dev:server   # Express server only
```

---

## File Structure

```
AIKiosq_Amazon_Hackathon/
├── index.html                          Entry HTML
├── App.tsx                             Main Orchestrator (React)
├── types.ts                            Shared TypeScript types
├── vite.config.ts                      Vite config + Socket.IO proxy
│
├── server/                             Express + Socket.IO server
│   ├── index.ts                        Server entry point (sessions, events)
│   ├── novaSonicClient.ts              Bedrock bidirectional streaming client
│   └── types.ts                        Server type definitions
│
├── services/
│   ├── novaSonicService.ts             Socket.IO client (browser ↔ server)
│   ├── novaAnalysisService.ts          Nova Lite 2 Converse API (vision)
│   ├── inventoryService.ts             Local JSON Search
│   ├── audioUtils.ts                   PCM/Base64 Encoders
│   └── imageUtils.ts                   Blob tools
│
├── components/
│   └── PlumbingThreadTeacher.tsx        Main visual display component
│
└── public/
    ├── inventory.json                  Mock Data
    ├── Aisle 17 Sign.jpg               Aisle location image
    └── compression_demo.mp4            Demo video
```

---

## Services

### Server: NovaSonicBidirectionalStreamClient (`server/novaSonicClient.ts`)
Manages the `BedrockRuntimeClient` with `InvokeModelWithBidirectionalStreamCommand` over HTTP/2.
- **StreamSession**: Per-connection state with audio queue, event dispatch, tool result relay
- **Event flow**: sessionStart → promptStart → systemPrompt (with tool specs) → audioStart → audioInput stream
- **Tool handling**: Receives toolUse events from Bedrock, relays to browser, browser executes and sends toolResult back

### Client: NovaSonicService (`services/novaSonicService.ts`)
Socket.IO client that connects to the Express server.
- **Input**: 16kHz Mono PCM (from Microphone) → base64 → emit `audioInput`
- **Output**: `audioOutput` events → decode → Web Audio API (24kHz playback)
- **Tools**: `toolUse` events → dispatch to App.tsx handlers → emit `toolResult` back

### NovaAnalysisService (`services/novaAnalysisService.ts`)
Calls `POST /api/analyze-part` on the Express server (not Bedrock directly).
- **Why proxied**: Browser has no AWS credentials on App Runner; all Bedrock calls must go server-side
- **Input**: Base64 Image + user question sent as JSON body
- **Server**: Calls Nova Lite 2 `ConverseCommand` using Instance Role credentials
- **Output**: Parsed text containing Part Name and Instructions
- **Temperature**: 0 (deterministic extraction)

---

## Troubleshooting
Consult these for answers:
1. https://github.com/aws-samples/amazon-nova-samples/issues
2. https://repost.aws/search/content?globalSearch=nova+sonic&search=nova+sonic&sort=relevant
3. Python reference: https://github.com/aws-samples/amazon-nova-samples/blob/main/speech-to-speech/sample-codes/console-python/nova_sonic_tool_use.py

| Problem | Cause | Fix |
|---------|-------|-----|
| **AccessDeniedException** | IAM User missing permissions | Attach `AmazonBedrockFullAccess` policy |
| **Unable to parse input chunk** | Tool schema not JSON stringified | Wrap all `inputSchema.json` values with `JSON.stringify()` |
| **Tool Response parsing error** | Tool result content must be JSON object | Wrap result in `JSON.stringify({ result: text, status: "success" })` |
| **contentType validation error** | Missing mediaType in tool result | Add `mediaType: "text/plain"` to `textInputConfiguration` in contentStart |
| **Tool result structure** | Incorrect event sequence or fields | Use: 1) contentStart (type: "TOOL", role: "TOOL"), 2) toolResult (content: JSON string), 3) contentEnd |
| **Connection Failed** | Invalid `.env.local` | Check keys. Restart both server and Vite |
| **Socket.IO Error** | Server not running | Run `npm run dev` (starts both processes) |
| **No Audio** | Browser Autoplay Policy | Click "Activate Sensors" to unlock AudioContext |
| **Tool not triggered** | Speech nuance | Speak clearly: "Here, take a look at this part" |
| **AI doesn't greet customer first** | Nova Sonic strictly requires audio input to trigger its response generation. A text turn is not enough. | Synthesize a short wake-up phrase into a `16kHz mono RAW PCM` file and inject it sequentially into the session stream immediately following `setupStartAudio()`, before capturing real mic input. |

---

## App Runner Deployment Troubleshooting

### Debugging Approach

When the App Runner service restarts unexpectedly, use this process:

1. **Check CloudWatch logs** — App Runner application logs are here:
   ```bash
   aws logs tail "/aws/apprunner/<service>/<id>/application" --since 30m --format short
   ```
2. **Check if it's pre-connection or post-connection** — if logs show only server startup and nothing after, the crash is client-side (browser can't reach the server). If logs show connection events then an error, it's server-side.
3. **Add synchronous stderr logging** — `console.log` is buffered and lost on SIGKILL. Use `process.stderr.write("msg\n")` in critical paths; it's synchronous and flushes before crash.
4. **Add a diagnostic endpoint** — `GET /test-bedrock` or `GET /health` lets you probe AWS credential availability without a full stream.

### Known App Runner Issues & Fixes

| Symptom | Root Cause | Fix |
|---------|------------|-----|
| **Kiosk reboots immediately** after "Connecting to Nova Sonic" | Socket.IO `transports: ["websocket"]` — App Runner's ALB doesn't reliably forward WebSocket upgrades | Use `transports: ["polling", "websocket"]` — polling works through all HTTP load balancers |
| **analyze_part always fails** | `novaAnalysisService.ts` called Bedrock from the browser with no credentials | Proxy Nova Lite calls through Express `POST /api/analyze-part` which has Instance Role |
| **Docker push 403 Forbidden** | ECR login token expires separately from `aws login` | Call `aws ecr get-login-password | docker login` before every push (now automated in `deploy.py`) |
| **No logs appear after crash** | Process SIGKILL'd before stdout flushes | Use `process.stderr.write()` (synchronous); stdout is async-buffered |
| **CredentialsProviderError** | `.env.local` has hardcoded keys that override Instance Role | Comment out `VITE_AWS_ACCESS_KEY_ID` etc. in `.env.local` for production |
| **Service reboots every ~8 min** | App Runner health check failures | Ensure `GET /health` returns 2xx; check port matches `SERVER_PORT` env var |

### Deploying

```bash
python deploy.py   # Builds Docker image, ECR login, push, trigger App Runner update
```

`deploy.py` automatically handles ECR authentication before each push.

### Tool Calling Requirements (Critical)
Nova Sonic tool calling has strict requirements:
1. **Tool Schema**: `inputSchema.json` must be `JSON.stringify(schema)`, not a plain object
2. **Tool Result Content**: Must be a JSON-stringified object, not plain text. Example: `JSON.stringify({ result: "text", status: "success" })`
3. **Tool Result Sequence**: Three events in order:
   - `contentStart` with `type: "TOOL"`, `role: "TOOL"`, `toolResultInputConfiguration`
   - `toolResult` with `promptName`, `contentName`, `content` (JSON string)
   - `contentEnd` with matching `promptName` and `contentName`
4. **Event Timing**: Execute tools on `contentEnd` event with `type: "TOOL"`, not immediately on `toolUse` event
