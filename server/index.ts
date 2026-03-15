import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { NovaSonicBidirectionalStreamClient, StreamSession } from "./novaSonicClient";
import { ToolSpec } from "./types";
import dotenv from "dotenv";

// ─────────────────────────────────────────────────────────────
// CRITICAL: Global process error handlers for App Runner debugging
// ─────────────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
    console.error("🔥 UNCAUGHT EXCEPTION:", err);
    console.error(err.stack);
    // On App Runner, a process exit will trigger a reboot. 
    // We log it first to see it in CloudWatch.
    setTimeout(() => process.exit(1), 1000);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("🔥 UNHANDLED REJECTION at:", promise, "reason:", reason);
    // No need to exit immediately, but helpful to know it's happening
});

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local for AWS credentials
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// ─────────────────────────────────────────────────────────────
// Express + Socket.IO setup
// ─────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        // In production (App Runner), the browser and server are on the same domain,
        // so we need to allow that origin. Allowing all origins is safe when the 
        // frontend is served from the same server.
        origin: process.env.NODE_ENV === "production" ? true : ["http://localhost:3000", "http://127.0.0.1:3000"],
        methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 1e7, // 10MB for audio chunks
});

// ─────────────────────────────────────────────────────────────
// Bedrock client
// ─────────────────────────────────────────────────────────────

const bedrockClient = new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
        maxConcurrentStreams: 10,
    },
    clientConfig: {
        region: process.env.VITE_AWS_REGION || process.env.AWS_REGION || "us-east-1",
        // Only provide explicit credentials if they are set in the environment.
        // Otherwise, the AWS SDK will automatically use the default credential provider
        // (files in ~/.aws locally, or Instance Role on App Runner).
        ...((process.env.VITE_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)
            ? {
                credentials: {
                    accessKeyId: process.env.VITE_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "",
                    secretAccessKey: process.env.VITE_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "",
                    ...(process.env.VITE_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN
                        ? { sessionToken: process.env.VITE_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN }
                        : {}),
                },
            }
            : {}),
    },
});

// ─────────────────────────────────────────────────────────────
// Sparky's system prompt and tool definitions
// ─────────────────────────────────────────────────────────────

const Sparky_SYSTEM_PROMPT = `You are Sparky, a veteran hardware store manager with 30 years of electrical experience. You work at a kiosk in a hardware store, helping customers identify electrical parts and find replacements.

Your personality:
- Warm, friendly, and approachable
- Practical, no-nonsense advice
- Occasional dad jokes about electricity or wiring
- Speak conversationally — you're face-to-face with the customer

How to help customers:
1. Greet them warmly and ask about their electrical problem
2. Listen carefully and ask clarifying questions
3. When the customer wants to show you a part (they say things like "here it is", "take a look", "can you see this", "I brought the part"), use the analyze_part tool to capture and analyze the image from the camera
4. After analysis, tell the customer what the part is and offer to explain installation or safety steps
5. If they want replacement parts, use check_inventory to find matching items in the store
6. After showing inventory, offer to show them where to find the parts using show_aisle

Keep your spoken responses concise — 2–3 sentences max. You're speaking out loud, not writing an essay.`;

const TOOL_SPECS: ToolSpec[] = [
    {
        toolSpec: {
            name: "analyze_part",
            description:
                "Capture and analyze an electrical part that the customer is showing to the kiosk camera. Use this when the customer indicates they want to show you a part — e.g. 'here it is', 'take a look at this', 'can you see it', 'I brought the part'. The kiosk camera will take a high-resolution snapshot and analyze it.",
            inputSchema: {
                json: JSON.stringify({
                    type: "object",
                    properties: {
                        description: {
                            type: "string",
                            description: "Brief summary of what the customer said about the part",
                        },
                    },
                    required: ["description"],
                }),
            },
        },
    },
    {
        toolSpec: {
            name: "check_inventory",
            description:
                "Search the store inventory for electrical parts matching the query. Use this when the customer wants to buy replacement parts or wants to know if the store carries something.",
            inputSchema: {
                json: JSON.stringify({
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "Search query — part name, type, or description to search for",
                        },
                    },
                    required: ["query"],
                }),
            },
        },
    },
    {
        toolSpec: {
            name: "show_aisle",
            description:
                "Display the aisle location sign on the kiosk screen so the customer can see where to find parts. Use this when the customer wants to know where parts are located in the store.",
            inputSchema: {
                json: JSON.stringify({
                    type: "object",
                    properties: {
                        aisle_name: {
                            type: "string",
                            description: "The aisle name or number to display",
                        },
                    },
                    required: ["aisle_name"],
                }),
            },
        },
    },
];

// ─────────────────────────────────────────────────────────────
// Session tracking
// ─────────────────────────────────────────────────────────────

enum SessionState {
    INITIALIZING = "initializing",
    READY = "ready",
    ACTIVE = "active",
    CLOSED = "closed",
}

const socketSessions = new Map<string, StreamSession>();
const sessionStates = new Map<string, SessionState>();
const cleanupInProgress = new Map<string, boolean>();

// Periodic cleanup of inactive sessions (5 min timeout)
setInterval(() => {
    const now = Date.now();
    bedrockClient.getActiveSessions().forEach((sessionId) => {
        const lastActivity = bedrockClient.getLastActivityTime(sessionId);
        if (now - lastActivity > 5 * 60 * 1000) {
            console.log(`Closing inactive session ${sessionId}`);
            bedrockClient.forceCloseSession(sessionId);
            socketSessions.delete(sessionId);
            sessionStates.set(sessionId, SessionState.CLOSED);
        }
    });
}, 60_000);

// ─────────────────────────────────────────────────────────────
// Socket.IO handlers
// ─────────────────────────────────────────────────────────────

function setupSessionEventHandlers(session: StreamSession, socket: any): void {
    session.onEvent("audioOutput", (data) => {
        socket.emit("audioOutput", data);
    });

    session.onEvent("textOutput", (data) => {
        console.log("Text output:", data);
        socket.emit("textOutput", data);
    });

    session.onEvent("toolUse", (data) => {
        socket.emit("toolUse", data);
    });

    session.onEvent("contentStart", (data) => {
        socket.emit("contentStart", data);
    });

    session.onEvent("contentEnd", (data) => {
        socket.emit("contentEnd", data);
    });

    session.onEvent("completionStart", (data) => {
        socket.emit("completionStart", data);
    });

    session.onEvent("error", (data) => {
        console.error("Session error:", data);
        socket.emit("error", data);
    });

    session.onEvent("streamComplete", () => {
        console.log("Stream completed for:", socket.id);
        socket.emit("streamComplete");
        sessionStates.set(socket.id, SessionState.CLOSED);
    });

    session.onEvent("usageEvent", (data) => {
        console.log("Usage:", data);
    });
}

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    sessionStates.set(socket.id, SessionState.CLOSED);

    // ── Initialize connection ──
    socket.on("initializeConnection", async (callback) => {
        try {
            const currentState = sessionStates.get(socket.id);
            if (
                currentState === SessionState.INITIALIZING ||
                currentState === SessionState.READY ||
                currentState === SessionState.ACTIVE
            ) {
                console.log(`Session already exists for ${socket.id}, state: ${currentState}`);
                if (callback) callback({ success: true });
                return;
            }

            console.log(`Creating session for ${socket.id}`);
            sessionStates.set(socket.id, SessionState.INITIALIZING);

            const session = bedrockClient.createStreamSession(socket.id);
            setupSessionEventHandlers(session, socket);
            socketSessions.set(socket.id, session);
            sessionStates.set(socket.id, SessionState.READY);

            console.log(`Initiating bidirectional stream for ${socket.id}...`);
            // Start bidirectional streaming (runs in background)
            bedrockClient.initiateBidirectionalStreaming(socket.id)
                .then(() => console.log(`Bidirectional stream initiated successfully for ${socket.id}`))
                .catch((err) => {
                    console.error(`FAILED to initiate bidirectional stream for ${socket.id}:`, err);
                    socket.emit("error", { message: "Failed to connect to Bedrock" });
                });
            
            sessionStates.set(socket.id, SessionState.ACTIVE);

            if (callback) callback({ success: true });
        } catch (error) {
            console.error("Error initializing session:", error);
            sessionStates.set(socket.id, SessionState.CLOSED);
            if (callback)
                callback({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
        }
    });

    // ── Prompt start (session start + prompt start with tool config) ──
    socket.on("promptStart", async () => {
        const session = socketSessions.get(socket.id);
        if (!session) return;
        try {
            await session.setupSessionAndPromptStart(TOOL_SPECS);
        } catch (error) {
            console.error("Error in promptStart:", error);
            socket.emit("error", { message: "Prompt start failed" });
        }
    });

    // ── System prompt ──
    socket.on("systemPrompt", async (data?: { systemPrompt?: string }) => {
        const session = socketSessions.get(socket.id);
        if (!session) return;
        try {
            const promptText = data?.systemPrompt || Sparky_SYSTEM_PROMPT;
            await session.setupSystemPrompt(promptText);
        } catch (error) {
            console.error("Error in systemPrompt:", error);
            socket.emit("error", { message: "System prompt failed" });
        }
    });

    // ── Audio start ──
    socket.on("audioStart", async () => {
        const session = socketSessions.get(socket.id);
        if (!session) return;
        try {
            await session.setupStartAudio();

            // Inject the wake-up audio trigger (Nova Sonic requires audio input to respond)
            const fs = await import("fs");
            const triggerPath = path.resolve(__dirname, "../public/trigger.raw");
            if (fs.existsSync(triggerPath)) {
                const triggerAudio = fs.readFileSync(triggerPath);
                const CHUNK_SIZE = 1024;
                for (let offset = 0; offset < triggerAudio.length; offset += CHUNK_SIZE) {
                    const chunkLength = Math.min(CHUNK_SIZE, triggerAudio.length - offset);
                    const chunk = triggerAudio.subarray(offset, offset + chunkLength);
                    await session.streamAudio(chunk);
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
                console.log("Wake-up audio trigger injected into stream");
            }

            socket.emit("audioReady");
        } catch (error) {
            console.error("Error in audioStart:", error);
            socket.emit("error", { message: "Audio start failed" });
        }
    });

    // ── Audio input ──
    socket.on("audioInput", async (audioData: string | Buffer) => {
        const session = socketSessions.get(socket.id);
        const state = sessionStates.get(socket.id);
        if (!session || state !== SessionState.ACTIVE) return;

        try {
            const audioBuffer =
                typeof audioData === "string" ? Buffer.from(audioData, "base64") : Buffer.from(audioData);
            await session.streamAudio(audioBuffer);
        } catch (error) {
            console.error("Error streaming audio:", error);
        }
    });

    // ── Tool result (from browser) ──
    socket.on("toolResult", async (data: { toolUseId: string; result: string }) => {
        const session = socketSessions.get(socket.id);
        if (!session) return;
        try {
            console.log(`Tool result for ${data.toolUseId}: ${data.result.substring(0, 100)}...`);
            await session.sendToolResult(data.toolUseId, data.result);
        } catch (error) {
            console.error("Error sending tool result:", error);
            socket.emit("error", { message: "Tool result relay failed" });
        }
    });

    // ── Stop audio / end session ──
    socket.on("stopAudio", async () => {
        const session = socketSessions.get(socket.id);
        if (!session || cleanupInProgress.get(socket.id)) return;

        console.log("Stop audio requested for:", socket.id);
        cleanupInProgress.set(socket.id, true);
        sessionStates.set(socket.id, SessionState.CLOSED);

        try {
            await Promise.race([
                (async () => {
                    await session.endAudioContent();
                    await session.endPrompt();
                    await session.close();
                })(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Cleanup timeout")), 5000)),
            ]);
        } catch (error) {
            console.error("Error during stop:", error);
            bedrockClient.forceCloseSession(socket.id);
        }

        socketSessions.delete(socket.id);
        cleanupInProgress.delete(socket.id);
        socket.emit("sessionClosed");
    });

    // ── Disconnect ──
    socket.on("disconnect", async () => {
        console.log("Client disconnected:", socket.id);
        const session = socketSessions.get(socket.id);

        if (session && bedrockClient.isSessionActive(socket.id) && !cleanupInProgress.get(socket.id)) {
            cleanupInProgress.set(socket.id, true);
            try {
                await Promise.race([
                    (async () => {
                        await session.endAudioContent();
                        await session.endPrompt();
                        await session.close();
                    })(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Cleanup timeout")), 3000)),
                ]);
            } catch {
                bedrockClient.forceCloseSession(socket.id);
            }
        }

        socketSessions.delete(socket.id);
        sessionStates.delete(socket.id);
        cleanupInProgress.delete(socket.id);
    });
});

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Nova Lite analysis proxy (runs server-side with Instance Role)
// ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: "10mb" }));

app.post("/api/analyze-part", async (req, res) => {
    const { imageBase64, userQuestion } = req.body as { imageBase64?: string; userQuestion?: string };

    if (!imageBase64) {
        res.status(400).json({ error: "imageBase64 is required" });
        return;
    }

    const region = process.env.VITE_AWS_REGION || process.env.AWS_REGION || "us-east-1";
    const prompt = `You are Sparky, a veteran hardware store manager with 30 years of electrician experience.

The customer is asking: "${userQuestion || "What is this part?"}"

Analyze the electrical part/component in this image and provide:

1. Identify what type of part this is (breaker, outlet, switch, wire, panel component, etc.)
2. Identify key specifications visible (voltage, amperage, brand, model, wire gauge, etc.)
3. Provide SHORT, QUICK step-by-step instructions to replace this part safely

Keep your response concise and practical. Use bullet points. Write like a friendly veteran who's done this a thousand times. Always mention safety first.

Format your response as:
PART: [name of part]

INSTRUCTIONS:
[numbered steps]`;

    try {
        const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");

        // Use same credential logic as main client for local development
        const credentials = (process.env.VITE_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)
            ? {
                accessKeyId: process.env.VITE_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "",
                secretAccessKey: process.env.VITE_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "",
                ...(process.env.VITE_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN
                    ? { sessionToken: process.env.VITE_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN }
                    : {}),
            }
            : undefined;

        console.log(`[/api/analyze-part] Analyzing image (${(imageBase64.length / 1024).toFixed(1)} KB)...`);

        const client = new BedrockRuntimeClient({
            region,
            credentials
        });

        // Use Buffer for Node.js base64 decoding
        const bytes = Buffer.from(imageBase64, 'base64');

        const command = new ConverseCommand({
            modelId: "us.amazon.nova-2-lite-v1:0",
            messages: [{
                role: "user",
                content: [
                    { image: { format: "jpeg", source: { bytes } } },
                    { text: prompt },
                ],
            }],
            inferenceConfig: { maxTokens: 1024, temperature: 0 },
        });

        const response = await client.send(command);
        const text = response.output?.message?.content?.[0];
        const textContent = text && "text" in text ? text.text : "";

        if (!textContent) throw new Error("No text content in Nova Lite response");

        console.log("[/api/analyze-part] Analysis successful");
        res.json({ result: textContent });
    } catch (err: any) {
        console.error("[/api/analyze-part] 🔥 ERROR:", err);
        res.status(500).json({ 
            error: err.message, 
            code: err.name,
            stack: process.env.NODE_ENV === "development" ? err.stack : undefined 
        });
    }
});

// ─────────────────────────────────────────────────────────────
// Health check & server start
// ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        activeSessions: bedrockClient.getActiveSessions().length,
        timestamp: new Date().toISOString(),
    });
});

// Diagnostic endpoint — tests AWS credentials and Bedrock access
app.get("/test-bedrock", async (_req, res) => {
    const region = process.env.VITE_AWS_REGION || process.env.AWS_REGION || "us-east-1";
    const credentialSource = process.env.VITE_AWS_ACCESS_KEY_ID
        ? "env-var (VITE_)"
        : process.env.AWS_ACCESS_KEY_ID
        ? "env-var (AWS_)"
        : "default-provider (instance-role)";

    try {
        // Use BedrockRuntimeClient which IS installed
        const { BedrockRuntimeClient } = await import("@aws-sdk/client-bedrock-runtime");
        const client = new BedrockRuntimeClient({ region });
        // Just resolving credentials is enough to test the provider
        const creds = await client.config.credentials();
        res.json({
            status: "ok",
            message: "AWS credentials resolved successfully",
            credentialSource,
            region,
            accessKeyId: creds.accessKeyId?.slice(0, 8) + "...",
            hasToken: !!creds.sessionToken,
        });
    } catch (err: any) {
        console.error("[/test-bedrock] Credential check failed:", err);
        res.status(500).json({
            status: "error",
            message: err.message,
            code: err.name,
            credentialSource,
            region,
        });
    }
});

// Serve static dist files in production
app.use(express.static(path.resolve(__dirname, "../dist")));

// SPA catchall — must come AFTER all API routes and static middleware
app.get("*", (_req, res) => {
    res.sendFile(path.resolve(__dirname, "../dist/index.html"));
});

const PORT = process.env.SERVER_PORT || 3001;
server.listen(PORT, () => {
    console.log(`Nova Sonic server listening on port ${PORT}`);
    console.log(`AWS Region: ${process.env.VITE_AWS_REGION || process.env.AWS_REGION || "us-east-1"}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
    console.log("Shutting down...");
    const forceExit = setTimeout(() => process.exit(1), 5000);

    try {
        await new Promise<void>((resolve) => io.close(() => resolve()));
        const active = bedrockClient.getActiveSessions();
        await Promise.all(
            active.map(async (id) => {
                try {
                    await bedrockClient.closeSession(id);
                } catch {
                    bedrockClient.forceCloseSession(id);
                }
            })
        );
        await new Promise<void>((resolve) => server.close(() => resolve()));
        clearTimeout(forceExit);
        process.exit(0);
    } catch {
        process.exit(1);
    }
});
