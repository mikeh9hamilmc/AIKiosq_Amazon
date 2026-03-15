export interface PartAnalysisResult {
    partName: string;
    instructions: string;
}

export class NovaAnalysisService {
    private modelId = "us.amazon.nova-2-lite-v1:0"; // kept for reference

    constructor() {}

    private parseResponse(text: string): PartAnalysisResult {
        const partMatch = text.match(/PART:\s*(.+?)(?:\n|$)/i);
        const instructionsMatch = text.match(/INSTRUCTIONS:\s*([\s\S]+?)(?=WARNINGS:|$)/i);
        return {
            partName: partMatch?.[1]?.trim() || "Electrical Component",
            instructions: instructionsMatch?.[1]?.trim() || text,
        };
    }

    async analyzePartForReplacement(imageBase64: string, userQuestion: string): Promise<PartAnalysisResult> {
        try {
            // Call the server-side proxy which has Instance Role credentials
            const response = await fetch("/api/analyze-part", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageBase64, userQuestion }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(err.error || `Server error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.result) throw new Error("No result in server response");

            return this.parseResponse(data.result);
        } catch (error) {
            console.error("Nova Lite analysis error:", error);
            throw new Error("Failed to analyze part with Nova Lite. Please try again.");
        }
    }
}
