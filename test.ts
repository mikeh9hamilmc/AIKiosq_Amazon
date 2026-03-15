import { NovaSonicBidirectionalStreamClient } from "./server/novaSonicClient";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env.local
dotenv.config({ path: path.resolve(".env.local") });

async function test() {
    console.log("Starting test...");
    const client = new NovaSonicBidirectionalStreamClient({
        clientConfig: {
            region: process.env.VITE_AWS_REGION || "us-east-1",
            credentials: {
                accessKeyId: process.env.VITE_AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.VITE_AWS_SECRET_ACCESS_KEY,
            }
        }
    });

    const sessionId = "test-session";
    const session = client.createStreamSession(sessionId);

    session.onEvent("any", (data) => console.log("Incoming event:", data.event, data.data));
    session.onEvent("error", (err) => console.log("ERROR EVENT:", err));

    client.initiateBidirectionalStreaming(sessionId).then(() => console.log("Stream completed")).catch(console.error);

    await new Promise(r => setTimeout(r, 1000));
    await session.setupSessionAndPromptStart([]);
    await session.setupSystemPrompt("You are a helpful assistant.");

    console.log("Sending start audio...");
    await session.setupStartAudio();
    
    console.log("Sending greeting turn after audio...");
    await session.setupGreetingTurn();
    
    // send some blank audio to keep it alive
    setTimeout(async () => {
        await session.streamAudio(Buffer.alloc(1024));
    }, 1000);

    setTimeout(async () => {
        await session.endAudioContent();
        await session.endPrompt();
        await session.close();
    }, 5000);
}

test().catch(console.error);
