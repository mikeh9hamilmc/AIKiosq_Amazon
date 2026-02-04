import {
    BedrockRuntimeClient,
    InvokeModelWithBidirectionalStreamCommand,
    InvokeModelWithBidirectionalStreamCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { Subject } from "rxjs";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_SESSION_CONFIG, ToolSpec, SessionConfig } from "./types";

// ─────────────────────────────────────────────────────────────
// StreamSession — per-connection state
// ─────────────────────────────────────────────────────────────

export class StreamSession {
    readonly sessionId: string;
    private promptName: string;
    private audioContentName: string;
    private config: SessionConfig;

    // Queue for outgoing events (raw event payloads, wrapped on yield)
    private eventQueue: Array<Record<string, unknown>> = [];
    private queueSignal = new Subject<void>();
    private isClosed = false;

    // Audio chunk buffer (max 200)
    private audioQueue: Buffer[] = [];
    private isStreamingAudio = false;
    private readonly MAX_AUDIO_QUEUE = 200;

    // Event handlers
    private eventHandlers: Map<string, Array<(data: any) => void>> = new Map();

    constructor(sessionId: string, config?: Partial<SessionConfig>) {
        this.sessionId = sessionId;
        this.promptName = `prompt-${uuidv4()}`;
        this.audioContentName = `audio-content-${uuidv4()}`;
        this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
    }

    // ── Event handling ──

    onEvent(eventName: string, handler: (data: any) => void): void {
        const handlers = this.eventHandlers.get(eventName) || [];
        handlers.push(handler);
        this.eventHandlers.set(eventName, handlers);
    }

    dispatchEvent(eventName: string, data: any): void {
        const handlers = this.eventHandlers.get(eventName) || [];
        const anyHandlers = this.eventHandlers.get("any") || [];
        handlers.forEach((h) => h(data));
        anyHandlers.forEach((h) => h({ event: eventName, data }));
    }

    // ── Queue management ──

    enqueueEvent(event: Record<string, unknown>): void {
        if (this.isClosed) return;
        this.eventQueue.push(event);
        this.queueSignal.next();
    }

    /**
     * Creates an async iterable that yields events in the format expected by
     * InvokeModelWithBidirectionalStreamCommand:
     *   { chunk: { bytes: Uint8Array(JSON.stringify({ event: payload })) } }
     */
    createAsyncIterable(): AsyncIterable<any> {
        const session = this;
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next(): Promise<IteratorResult<any>> {
                        // Wait for events to be available
                        while (session.eventQueue.length === 0 && !session.isClosed) {
                            await new Promise<void>((resolve) => {
                                const sub = session.queueSignal.subscribe(() => {
                                    sub.unsubscribe();
                                    resolve();
                                });
                                // Check again in case state changed
                                if (session.isClosed || session.eventQueue.length > 0) {
                                    sub.unsubscribe();
                                    resolve();
                                }
                            });
                        }

                        if (session.eventQueue.length > 0) {
                            const rawEvent = session.eventQueue.shift()!;
                            const wrapped = { event: rawEvent };
                            const json = JSON.stringify(wrapped);

                            return {
                                value: {
                                    chunk: {
                                        bytes: new TextEncoder().encode(json),
                                    },
                                },
                                done: false,
                            };
                        }

                        // Queue empty and closed
                        return { value: undefined, done: true };
                    },
                };
            },
        };
    }

    // ── Session lifecycle ──

    async setupSessionAndPromptStart(toolSpecs?: ToolSpec[]): Promise<void> {
        // 1. Session start
        this.enqueueEvent({
            sessionStart: {
                inferenceConfiguration: {
                    maxTokens: this.config.inferenceConfig.maxTokens,
                    topP: this.config.inferenceConfig.topP,
                    temperature: this.config.inferenceConfig.temperature,
                },
            },
        });

        // 2. Prompt start (includes tool configuration if tools provided)
        const promptStartPayload: Record<string, unknown> = {
            promptName: this.promptName,
            textOutputConfiguration: {
                mediaType: this.config.textOutputConfig.mediaType,
            },
            audioOutputConfiguration: {
                mediaType: this.config.audioOutputConfig.mediaType,
                sampleRateHertz: this.config.audioOutputConfig.sampleRateHertz,
                sampleSizeBits: this.config.audioOutputConfig.sampleSizeBits,
                channelCount: this.config.audioOutputConfig.channelCount,
                voiceId: this.config.audioOutputConfig.voiceId,
                encoding: this.config.audioOutputConfig.encoding,
                audioType: this.config.audioOutputConfig.audioType,
            },
            toolUseOutputConfiguration: {
                mediaType: "application/json",
            },
        };

        if (toolSpecs && toolSpecs.length > 0) {
            promptStartPayload.toolConfiguration = {
                tools: toolSpecs,
            };
        }

        this.enqueueEvent({
            promptStart: promptStartPayload,
        });
    }

    async setupSystemPrompt(systemPromptText?: string): Promise<void> {
        const systemText = systemPromptText || "You are a helpful assistant.";
        const textPromptId = `system-prompt-${uuidv4()}`;

        // contentStart for system text
        this.enqueueEvent({
            contentStart: {
                promptName: this.promptName,
                contentName: textPromptId,
                type: "TEXT",
                interactive: false,
                role: "SYSTEM",
                textInputConfiguration: {
                    mediaType: "text/plain",
                },
            },
        });

        // Text content
        this.enqueueEvent({
            textInput: {
                promptName: this.promptName,
                contentName: textPromptId,
                content: systemText,
            },
        });

        // contentEnd
        this.enqueueEvent({
            contentEnd: {
                promptName: this.promptName,
                contentName: textPromptId,
            },
        });
    }

    async setupStartAudio(): Promise<void> {
        this.enqueueEvent({
            contentStart: {
                promptName: this.promptName,
                contentName: this.audioContentName,
                type: "AUDIO",
                interactive: true,
                role: "USER",
                audioInputConfiguration: {
                    mediaType: this.config.audioInputConfig.mediaType,
                    sampleRateHertz: this.config.audioInputConfig.sampleRateHertz,
                    sampleSizeBits: this.config.audioInputConfig.sampleSizeBits,
                    channelCount: this.config.audioInputConfig.channelCount,
                    audioType: this.config.audioInputConfig.audioType,
                    encoding: this.config.audioInputConfig.encoding,
                },
            },
        });
    }

    async streamAudio(audioBuffer: Buffer): Promise<void> {
        if (this.isClosed) return;

        this.audioQueue.push(audioBuffer);

        while (this.audioQueue.length > this.MAX_AUDIO_QUEUE) {
            this.audioQueue.shift();
        }

        if (!this.isStreamingAudio) {
            this.isStreamingAudio = true;
            while (this.audioQueue.length > 0) {
                const batch = this.audioQueue.splice(0, 5);
                for (const chunk of batch) {
                    this.enqueueEvent({
                        audioInput: {
                            promptName: this.promptName,
                            contentName: this.audioContentName,
                            content: chunk.toString("base64"),
                        },
                    });
                }
            }
            this.isStreamingAudio = false;
        }
    }

    async sendToolResult(toolUseId: string, resultText: string): Promise<void> {
        const contentId = `tool-result-${uuidv4()}`;

        const contentStartEvent = {
            contentStart: {
                promptName: this.promptName,
                contentName: contentId,
                interactive: false,
                type: "TOOL",
                role: "TOOL",  // Must be TOOL per AWS Python sample
                toolResultInputConfiguration: {
                    toolUseId: toolUseId,
                    type: "TEXT",
                    textInputConfiguration: {
                        mediaType: "text/plain",  // Required field
                    },
                },
            },
        };
        this.enqueueEvent(contentStartEvent);

        // Structure content as JSON object
        const contentObject = {
            result: resultText,
            status: "success"
        };

        const toolResultEvent = {
            toolResult: {
                promptName: this.promptName,
                contentName: contentId,
                content: JSON.stringify(contentObject),  // JSON object stringified
            },
        };
        this.enqueueEvent(toolResultEvent);

        const contentEndEvent = {
            contentEnd: {
                promptName: this.promptName,
                contentName: contentId,
            },
        };
        this.enqueueEvent(contentEndEvent);
    }

    async endAudioContent(): Promise<void> {
        this.enqueueEvent({
            contentEnd: {
                promptName: this.promptName,
                contentName: this.audioContentName,
            },
        });
    }

    async endPrompt(): Promise<void> {
        this.enqueueEvent({
            promptEnd: {
                promptName: this.promptName,
            },
        });
    }

    async close(): Promise<void> {
        this.enqueueEvent({
            sessionEnd: {},
        });
        this.isClosed = true;
        this.queueSignal.next(); // Wake up the iterator
        this.queueSignal.complete();
    }

    get closed(): boolean {
        return this.isClosed;
    }
}

// ─────────────────────────────────────────────────────────────
// NovaSonicBidirectionalStreamClient
// ─────────────────────────────────────────────────────────────

export interface ClientConfig {
    requestHandlerConfig?: {
        maxConcurrentStreams?: number;
    };
    clientConfig: {
        region: string;
        credentials?: any;
    };
}

export class NovaSonicBidirectionalStreamClient {
    private client: BedrockRuntimeClient;
    private sessions: Map<string, StreamSession> = new Map();
    private lastActivity: Map<string, number> = new Map();
    private modelId = "amazon.nova-2-sonic-v1:0";

    constructor(config: ClientConfig) {
        const maxStreams = config.requestHandlerConfig?.maxConcurrentStreams ?? 20;

        this.client = new BedrockRuntimeClient({
            ...config.clientConfig,
            requestHandler: new NodeHttp2Handler({
                requestTimeout: 300_000,
                sessionTimeout: 300_000,
                maxConcurrentStreams: maxStreams,
            }),
        });
    }

    createStreamSession(sessionId: string): StreamSession {
        const session = new StreamSession(sessionId);
        this.sessions.set(sessionId, session);
        this.lastActivity.set(sessionId, Date.now());
        return session;
    }

    getSession(sessionId: string): StreamSession | undefined {
        return this.sessions.get(sessionId);
    }

    isSessionActive(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        return !!session && !session.closed;
    }

    getActiveSessions(): string[] {
        return Array.from(this.sessions.entries())
            .filter(([, s]) => !s.closed)
            .map(([id]) => id);
    }

    getLastActivityTime(sessionId: string): number {
        return this.lastActivity.get(sessionId) ?? 0;
    }

    forceCloseSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.close().catch(() => {});
        }
        this.sessions.delete(sessionId);
        this.lastActivity.delete(sessionId);
    }

    async closeSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.endAudioContent();
            await session.endPrompt();
            await session.close();
        }
        this.sessions.delete(sessionId);
        this.lastActivity.delete(sessionId);
    }

    async initiateBidirectionalStreaming(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`No session found with id: ${sessionId}`);
        }

        try {
            this.lastActivity.set(sessionId, Date.now());

            const input: InvokeModelWithBidirectionalStreamCommandInput = {
                modelId: this.modelId,
                body: session.createAsyncIterable() as any,
            };

            const command = new InvokeModelWithBidirectionalStreamCommand(input as any);
            const response = await this.client.send(command);

            if (response.body) {
                for await (const event of response.body) {
                    this.lastActivity.set(sessionId, Date.now());

                    try {
                        this.processResponseEvent(session, event);
                    } catch (eventError) {
                        console.error(`Error processing event for ${sessionId}:`, eventError);
                        session.dispatchEvent("error", {
                            message: "Error processing response event",
                            details: eventError instanceof Error ? eventError.message : String(eventError),
                        });
                    }
                }
            }

            session.dispatchEvent("streamComplete", {});
        } catch (error) {
            console.error(`Bidirectional stream error for ${sessionId}:`, error);
            session.dispatchEvent("error", {
                message: "Stream error",
                details: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private processResponseEvent(session: StreamSession, event: any): void {
        // Response events arrive as chunks with bytes containing JSON
        let parsed: any = null;

        if (event.chunk?.bytes) {
            const text = new TextDecoder().decode(event.chunk.bytes);
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = { rawText: text };
            }
        } else if (event.chunk && typeof event.chunk === "object") {
            parsed = event.chunk;
        }

        if (!parsed) return;

        // Unwrap the { event: { ... } } envelope if present
        const payload = parsed.event || parsed;

        // Route based on event type
        if (payload.contentStart) {
            if (payload.contentStart.type === "TOOL" && payload.contentStart.toolUse) {
                session.dispatchEvent("toolUseStart", payload.contentStart);
            }
            session.dispatchEvent("contentStart", payload.contentStart);
        } else if (payload.textOutput) {
            session.dispatchEvent("textOutput", payload.textOutput);
        } else if (payload.audioOutput) {
            session.dispatchEvent("audioOutput", payload.audioOutput);
        } else if (payload.toolUse) {
            session.dispatchEvent("toolUse", payload.toolUse);
        } else if (payload.contentEnd) {
            session.dispatchEvent("contentEnd", payload.contentEnd);
        } else if (payload.completionStart) {
            session.dispatchEvent("completionStart", payload.completionStart);
        } else if (payload.completionEnd) {
            session.dispatchEvent("completionEnd", payload.completionEnd);
        } else if (payload.usageEvent) {
            session.dispatchEvent("usageEvent", payload.usageEvent);
        } else {
            session.dispatchEvent("unknown", payload);
        }
    }
}
