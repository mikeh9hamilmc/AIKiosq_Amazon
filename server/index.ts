import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { NovaSonicBidirectionalStreamClient, StreamSession } from "./novaSonicClient";
import { ToolSpec } from "./types";
import dotenv from "dotenv";

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
        origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
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
        credentials: {
            accessKeyId: process.env.VITE_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "",
            secretAccessKey: process.env.VITE_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "",
            ...(process.env.VITE_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN
                ? { sessionToken: process.env.VITE_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN }
                : {}),
        },
    },
});

// ─────────────────────────────────────────────────────────────
// Mac's system prompt and tool definitions
// ─────────────────────────────────────────────────────────────

const MAC_SYSTEM_PROMPT = `You are Mac, a veteran hardware store manager with 30 years of plumbing experience. You work at a kiosk in a hardware store, helping customers identify plumbing parts and find replacements.

Your personality:
- Warm, friendly, and approachable
- Practical, no-nonsense advice
- Occasional dad jokes about plumbing
- Speak conversationally — you're face-to-face with the customer

How to help customers:
1. Greet them warmly and ask about their plumbing problem
2. Listen carefully and ask clarifying questions
3. When the customer wants to show you a part (they say things like "here it is", "take a look", "can you see this", "I brought the part"), use the analyze_part tool to capture and analyze the image from the camera
4. After analysis, tell the customer what the part is and offer to explain replacement steps
5. If they want replacement parts, use check_inventory to find matching items in the store
6. After showing inventory, offer to show them where to find the parts using show_aisle

Keep your spoken responses concise — 2–3 sentences max. You're speaking out loud, not writing an essay.`;

const TOOL_SPECS: ToolSpec[] = [
    {
        toolSpec: {
            name: "analyze_part",
            description:
                "Capture and analyze a plumbing part that the customer is showing to the kiosk camera. Use this when the customer indicates they want to show you a part — e.g. 'here it is', 'take a look at this', 'can you see it', 'I brought the part'. The kiosk camera will take a high-resolution snapshot and analyze it.",
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
                "Search the store inventory for plumbing parts matching the query. Use this when the customer wants to buy replacement parts or wants to know if the store carries something.",
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

            // Start bidirectional streaming (runs in background)
            bedrockClient.initiateBidirectionalStreaming(socket.id);
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
            const promptText = data?.systemPrompt || MAC_SYSTEM_PROMPT;
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
// Health check & server start
// ─────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        activeSessions: bedrockClient.getActiveSessions().length,
        timestamp: new Date().toISOString(),
    });
});

// Serve static dist files in production
app.use(express.static(path.resolve(__dirname, "../dist")));

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
