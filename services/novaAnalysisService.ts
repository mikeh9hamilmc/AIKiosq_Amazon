import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";


export interface PartAnalysisResult {
    partName: string;
    instructions: string;
}

export class NovaAnalysisService {
    private client: BedrockRuntimeClient;
    private modelId = "us.amazon.nova-2-lite-v1:0";

    constructor() {
        this.client = new BedrockRuntimeClient({
            region: import.meta.env.VITE_AWS_REGION || process.env.AWS_REGION || "us-east-1",
            credentials: {
                accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "",
                secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "",
            },
        });
    }

    private base64ToBytes(base64: string): Uint8Array {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    async analyzePartForReplacement(imageBase64: string, userQuestion: string): Promise<PartAnalysisResult> {
        const prompt = `You are Mac, a veteran hardware store manager with 30 years of plumbing experience.

The customer is asking: "${userQuestion}"

Analyze the plumbing part in this image and provide:

1. Identify what type of part this is (valve, fitting, trap, etc.)
2. Identify the pipe connection types visible (compression, NPT threaded, slip joint, etc.)
3. Provide SHORT, QUICK step-by-step instructions to replace this part


Keep your response concise and practical. Use bullet points. Write like a friendly veteran who's done this a thousand times.

Format your response as:
PART: [name of part]

INSTRUCTIONS:
[numbered steps]`;

        try {
            const command = new ConverseCommand({
                modelId: this.modelId,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                image: {
                                    format: "jpeg",
                                    source: {
                                        bytes: this.base64ToBytes(imageBase64),
                                    },
                                },
                            },
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                inferenceConfig: {
                    maxTokens: 1024,
                    temperature: 0,
                }
            });

            const response = await this.client.send(command);

            const responseContent = response.output?.message?.content?.[0];
            const text = responseContent && 'text' in responseContent ? responseContent.text : '';

            if (!text) {
                throw new Error("No text content in response");
            }

            // Parse the response
            const partMatch = text.match(/PART:\s*(.+?)(?:\n|$)/i);
            const instructionsMatch = text.match(/INSTRUCTIONS:\s*([\s\S]+?)(?=WARNINGS:|$)/i);

            return {
                partName: partMatch?.[1]?.trim() || 'Plumbing Component',
                instructions: instructionsMatch?.[1]?.trim() || text,
            };

        } catch (error) {
            console.error('Nova Lite analysis error:', error);
            throw new Error('Failed to analyze part with Nova Lite. Please try again.');
        }
    }
}
