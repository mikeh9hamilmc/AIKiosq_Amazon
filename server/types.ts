export interface InferenceConfig {
    readonly maxTokens: number;
    readonly topP: number;
    readonly temperature: number;
}

export type ContentType = "AUDIO" | "TEXT" | "TOOL";
export type AudioType = "SPEECH";
export type AudioMediaType = "audio/lpcm";
export type TextMediaType = "text/plain" | "application/json";

export interface AudioConfiguration {
    readonly audioType: AudioType;
    readonly mediaType: AudioMediaType;
    readonly sampleRateHertz: number;
    readonly sampleSizeBits: number;
    readonly channelCount: number;
    readonly encoding: string;
    readonly voiceId?: string;
}

export interface TextConfiguration {
    readonly mediaType: TextMediaType;
}

export interface ToolConfiguration {
    readonly toolUseId: string;
    readonly type: "TEXT";
    readonly textInputConfiguration: {
        readonly mediaType: "text/plain";
    };
}

export interface ToolSpec {
    toolSpec: {
        name: string;
        description: string;
        inputSchema: {
            json: string;
        };
    };
}

export interface SessionConfig {
    inferenceConfig: InferenceConfig;
    audioInputConfig: AudioConfiguration;
    audioOutputConfig: AudioConfiguration;
    textOutputConfig: TextConfiguration;
    toolUseOutputConfig?: TextConfiguration;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
    inferenceConfig: {
        maxTokens: 1024,
        topP: 0.9,
        temperature: 0.7,
    },
    audioInputConfig: {
        audioType: "SPEECH",
        mediaType: "audio/lpcm",
        sampleRateHertz: 16000,
        sampleSizeBits: 16,
        channelCount: 1,
        encoding: "base64",
    },
    audioOutputConfig: {
        audioType: "SPEECH",
        mediaType: "audio/lpcm",
        sampleRateHertz: 24000,
        sampleSizeBits: 16,
        channelCount: 1,
        voiceId: "matthew",
        encoding: "base64",
    },
    textOutputConfig: {
        mediaType: "text/plain",
    },
    toolUseOutputConfig: {
        mediaType: "text/plain",
    },
};
