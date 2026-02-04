import { io, Socket } from "socket.io-client";
import { decode, decodeAudioData, createPcmBlob } from "./audioUtils";
import { LessonStage } from "../types";

export interface LiveServiceCallbacks {
    onStageChange: (stage: LessonStage) => void;
    onStatusChange: (status: string) => void;
    onAnalyzePart: (imageBase64: string, userQuestion: string) => Promise<string>;
    onCheckInventory: (query: string) => Promise<string>;
    onShowAisleSign: (aisleName: string) => void;
    onSessionEnd: () => void;
}

export class NovaSonicService {
    private socket: Socket | null = null;
    private inputAudioContext: AudioContext | null = null;
    private outputAudioContext: AudioContext | null = null;
    private nextStartTime = 0;
    private sources = new Set<AudioBufferSourceNode>();
    private isPaused = false;
    private scriptProcessor: ScriptProcessorNode | null = null;
    private mediaSource: MediaStreamAudioSourceNode | null = null;
    private callbacks: LiveServiceCallbacks | null = null;
    private pendingToolUseId: string | null = null;
    private pendingToolName: string | null = null;
    private pendingToolContent: string | null = null;

    constructor() {}

    public async disconnect(): Promise<void> {
        // Stop audio capture
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }
        if (this.mediaSource) {
            this.mediaSource.disconnect();
            this.mediaSource = null;
        }

        // Tell server to stop
        if (this.socket?.connected) {
            this.socket.emit("stopAudio");
            // Give server a moment to clean up before disconnecting
            await new Promise((resolve) => setTimeout(resolve, 200));
            this.socket.disconnect();
        }
        this.socket = null;

        // Close audio contexts
        if (this.inputAudioContext && this.inputAudioContext.state !== "closed") {
            await this.inputAudioContext.close();
        }
        if (this.outputAudioContext && this.outputAudioContext.state !== "closed") {
            await this.outputAudioContext.close();
        }
        this.inputAudioContext = null;
        this.outputAudioContext = null;
        this.nextStartTime = 0;
        this.sources.forEach((s) => { try { s.stop(); } catch {} });
        this.sources.clear();
        this.isPaused = false;
        this.callbacks = null;
        this.pendingToolUseId = null;
        this.pendingToolName = null;
        this.pendingToolContent = null;
    }

    public async start(callbacks: LiveServiceCallbacks, stream: MediaStream): Promise<void> {
        this.callbacks = callbacks;
        this.isPaused = false;

        // Create audio contexts
        this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
            sampleRate: 16000,
        });
        this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
            sampleRate: 24000,
        });

        const outputNode = this.outputAudioContext.createGain();
        outputNode.connect(this.outputAudioContext.destination);

        try {
            callbacks.onStatusChange("Connecting to Nova Sonic server...");

            // Connect to Socket.IO server (same origin, proxied by Vite in dev)
            this.socket = io({
                transports: ["websocket"],
                timeout: 10000,
            });

            // Wait for connection
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("Socket.IO connection timeout")), 10000);
                this.socket!.on("connect", () => {
                    clearTimeout(timeout);
                    resolve();
                });
                this.socket!.on("connect_error", (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });

            console.log("Socket.IO connected:", this.socket.id);
            callbacks.onStatusChange("Connected to server. Initializing Nova Sonic...");

            // Register event listeners BEFORE initializing
            this.registerEventListeners(outputNode, callbacks);

            // Initialize the Bedrock session on the server
            await new Promise<void>((resolve, reject) => {
                this.socket!.emit("initializeConnection", (response: { success: boolean; error?: string }) => {
                    if (response.success) {
                        resolve();
                    } else {
                        reject(new Error(response.error || "Failed to initialize"));
                    }
                });
            });

            // Send prompt start → system prompt → audio start (sequentially)
            this.socket.emit("promptStart");
            // Small delay to ensure ordering
            await new Promise((resolve) => setTimeout(resolve, 100));
            this.socket.emit("systemPrompt");
            await new Promise((resolve) => setTimeout(resolve, 100));
            this.socket.emit("audioStart");

            // Wait for audioReady from server, then start mic capture
            await new Promise<void>((resolve) => {
                this.socket!.once("audioReady", () => {
                    console.log("Server ready for audio input");
                    this.startAudioCapture(stream);
                    callbacks.onStatusChange("Connected: Mac is listening...");
                    resolve();
                });
            });
        } catch (e: any) {
            console.error("Nova Sonic Connection Error:", e);
            callbacks.onStatusChange(`Connection Failed: ${e.message}`);
            callbacks.onSessionEnd();
        }
    }

    private registerEventListeners(outputNode: GainNode, callbacks: LiveServiceCallbacks): void {
        if (!this.socket) return;

        // Audio output from Nova Sonic (Mac speaking)
        this.socket.on("audioOutput", (data: { content?: string }) => {
            if (data.content) {
                const audioBytes = decode(data.content);
                this.playAudio(audioBytes, outputNode);
            }
        });

        // Text output (transcript)
        this.socket.on("textOutput", (data: { content?: string; role?: string }) => {
            if (data.content) {
                console.log(`Nova [${data.role || "assistant"}]:`, data.content);
            }
        });

        // Tool use — accumulate tool call data (don't execute yet)
        this.socket.on("toolUse", (data: { toolName?: string; toolUseId?: string; content?: string }) => {
            // Store the tool content (arguments). toolUseId/toolName may also arrive here.
            if (data.content) this.pendingToolContent = data.content;
            if (data.toolUseId) this.pendingToolUseId = data.toolUseId;
            if (data.toolName) this.pendingToolName = data.toolName;
        });

        // Content start — accumulate tool use info (don't execute yet)
        this.socket.on("contentStart", (data: any) => {
            if (data.type === "TOOL" && data.toolUse) {
                this.pendingToolUseId = data.toolUse.toolUseId;
                this.pendingToolName = data.toolUse.toolName;
            }
        });

        // Content end — execute tool ONLY after Bedrock finishes sending tool use content
        this.socket.on("contentEnd", (data: any) => {
            if (data.type === "TOOL" && this.pendingToolUseId && this.pendingToolName) {
                this.handleToolUse(
                    {
                        toolName: this.pendingToolName,
                        toolUseId: this.pendingToolUseId,
                        content: this.pendingToolContent || "",
                    },
                    callbacks
                );
                // Clear pending state
                this.pendingToolName = null;
                this.pendingToolContent = null;
                this.pendingToolUseId = null;
            }
        });

        // Errors
        this.socket.on("error", (data: { message: string; details?: string }) => {
            console.error("Server error:", data.message, data.details);
            callbacks.onStatusChange(`Error: ${data.message}`);
        });

        // Session closed
        this.socket.on("sessionClosed", () => {
            console.log("Session closed by server");
            callbacks.onSessionEnd();
        });

        // Stream complete
        this.socket.on("streamComplete", () => {
            console.log("Stream complete");
            callbacks.onSessionEnd();
        });

        // Disconnect
        this.socket.on("disconnect", (reason) => {
            console.log("Socket disconnected:", reason);
            if (reason !== "io client disconnect") {
                callbacks.onStatusChange("Connection lost");
                callbacks.onSessionEnd();
            }
        });
    }

    private async handleToolUse(
        data: { toolName?: string; toolUseId?: string; content?: string },
        callbacks: LiveServiceCallbacks
    ): Promise<void> {
        const toolName = data.toolName;
        const toolUseId = data.toolUseId || this.pendingToolUseId;

        if (!toolName || !toolUseId) {
            return;
        }

        // Parse tool input
        let toolInput: Record<string, string> = {};
        if (data.content) {
            try {
                toolInput = JSON.parse(data.content);
            } catch {
                toolInput = { description: data.content };
            }
        }

        console.log(`🔧 Tool called: ${toolName}`);

        // Pause audio capture during tool execution
        this.isPaused = true;

        let result = "";

        try {
            switch (toolName) {
                case "analyze_part":
                    console.log(`📸 Analyzing part...`);
                    result = await callbacks.onAnalyzePart("", toolInput.description || "Identifying part...");
                    console.log(`✅ Part analysis complete`);
                    break;

                case "check_inventory":
                    console.log(`🔍 Checking inventory for: ${toolInput.query || "parts"}`);
                    result = await callbacks.onCheckInventory(toolInput.query || "");
                    console.log(`✅ Inventory check complete`);
                    break;

                case "show_aisle":
                    console.log(`🗺️  Showing aisle: ${toolInput.aisle_name || "Aisle 5"}`);
                    callbacks.onShowAisleSign(toolInput.aisle_name || "Aisle 5");
                    result = `Showing aisle sign for "${toolInput.aisle_name || "Aisle 5"}" on the kiosk screen. The customer can now see where to go. Say goodbye and wish them luck with the repair.`;
                    console.log(`✅ Aisle sign displayed`);
                    break;

                default:
                    result = `Unknown tool: ${toolName}`;
            }
        } catch (error) {
            console.error(`❌ Tool ${toolName} failed:`, error);
            result = `Tool ${toolName} failed: ${error instanceof Error ? error.message : String(error)}`;
        }

        // Send tool result back to server → Bedrock
        if (this.socket?.connected) {
            this.socket.emit("toolResult", { toolUseId, result });
        }

        // Resume audio capture
        this.isPaused = false;
    }

    private startAudioCapture(stream: MediaStream): void {
        if (!this.inputAudioContext || !this.socket) return;

        this.mediaSource = this.inputAudioContext.createMediaStreamSource(stream);
        this.scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

        this.scriptProcessor.onaudioprocess = (event) => {
            if (this.isPaused || !this.socket?.connected) return;

            const inputData = event.inputBuffer.getChannelData(0);
            const pcmBlob = createPcmBlob(inputData);

            // Send base64-encoded PCM to server
            this.socket.emit("audioInput", pcmBlob.data);
        };

        this.mediaSource.connect(this.scriptProcessor);
        this.scriptProcessor.connect(this.inputAudioContext.destination);
    }

    private async playAudio(data: Uint8Array, outputNode: AudioNode): Promise<void> {
        if (!this.outputAudioContext) return;

        this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
        const audioBuffer = await decodeAudioData(data, this.outputAudioContext, 24000, 1);
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputNode);
        source.addEventListener("ended", () => this.sources.delete(source));
        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
        this.sources.add(source);
    }
}
