# AIKiosQ - Mac's Hardware Store Kiosk (Amazon Nova Edition)

## System Overview

AIKiosQ is a React + TypeScript kiosk application for hardware stores. It uses **Amazon Bedrock** for all AI capabilities:

| Model | Purpose | Usage |
|-------|---------|-------|
| **Amazon Nova Sonic** (`amazon.nova-2-sonic-v1:0`) | Real-time Speech-to-Speech conversation | Bidirectional HTTP/2 Stream via Express+Socket.IO server |
| **Amazon Nova Lite 2** (`us.amazon.nova-2-lite-v1:0`) | Deep part analysis with image input | On-demand snapshots via `Converse API` (browser-side) |
| Mock JSON | Inventory lookup | Instant |

The AI persona is **"Mac"** — a veteran hardware store manager with 30 years of plumbing experience and a friendly, funny personality.

---

## Architecture

Nova Sonic requires HTTP/2 bidirectional streaming, which is only available server-side (Node.js). The application uses a two-process architecture:

```
Browser (React + Vite :3000)              Server (Express + Socket.IO :3001)
┌──────────────────────────┐              ┌──────────────────────────────────┐
│ App.tsx                   │   Socket.IO  │ server/index.ts                  │
│ - Motion detection        │◄───────────►│ - Session management             │
│ - Camera/mic capture      │   (proxied)  │ - NovaSonicBidirectionalClient   │
│ - Audio playback          │              │   - Bedrock HTTP/2 stream        │
│ - UI rendering            │              │   - Tool event relay to client   │
│ - Tool execution          │              │ - AWS credentials (server-side)  │
│   (Nova Lite Converse)    │              │                                  │
│                           │              │ server/novaSonicClient.ts        │
│ services/                 │              │ server/types.ts                  │
│  novaSonicService.ts      │              │                                  │
│  (Socket.IO client)       │              │                                  │
│  novaAnalysisService.ts   │              │                                  │
│  (Bedrock Converse API)   │              │                                  │
└──────────────────────────┘              └──────────────────────────────────┘
```

Vite dev server proxies `/socket.io` WebSocket connections to `:3001`.

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
 │    Mac greets customer automatically via System Prompt                    │
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
 │           7. Mac tells customer what part it is                          │
 │           8. Mac asks if user wants instructions                         │
 │           9. Mac asks if user wants to check inventory                   │
 │                                                                          │
 │    check_inventory(query)                                                │
 │       │                                                                  │
 │       └─→ 1. Search inventory.json                                       │
 │           2. Display results on screen (Product Cards)                   │
 │           3. Send toolResult to Bedrock                                  │
 │           4. Mac tells customer what's in stock                          │
 │           5. Mac offers to show aisle location                           │
 │                                                                          │
 │    show_aisle(aisle_name)                                                │
 │       │                                                                  │
 │       └─→ 1. Display aisle sign image on screen                          │
 │           2. Send toolResult to Bedrock                                  │
 │           3. Mac says goodbye                                            │
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
    ├── Aisle 5 Sign.jpg                Aisle location image
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
Standard `ConverseCommand` client for Nova Lite 2 (runs in browser).
- **Input**: Base64 Image + Text Prompt (image BEFORE text per Nova 2 docs)
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

### Tool Calling Requirements (Critical)
Nova Sonic tool calling has strict requirements:
1. **Tool Schema**: `inputSchema.json` must be `JSON.stringify(schema)`, not a plain object
2. **Tool Result Content**: Must be a JSON-stringified object, not plain text. Example: `JSON.stringify({ result: "text", status: "success" })`
3. **Tool Result Sequence**: Three events in order:
   - `contentStart` with `type: "TOOL"`, `role: "TOOL"`, `toolResultInputConfiguration`
   - `toolResult` with `promptName`, `contentName`, `content` (JSON string)
   - `contentEnd` with matching `promptName` and `contentName`
4. **Event Timing**: Execute tools on `contentEnd` event with `type: "TOOL"`, not immediately on `toolUse` event
