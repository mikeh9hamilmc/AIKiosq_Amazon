const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

async function test() {
    console.log("Testing AWS SDK credentials loading on host...");
    const client = new STSClient({ region: "us-east-1" });
    try {
        const response = await client.send(new GetCallerIdentityCommand({}));
        console.log("✅ Success! Identity:", response.Arn);
        console.log("Account:", response.Account);
    } catch (err) {
        console.error("❌ Failed to load credentials:", err.message);
        if (err.stack) console.error(err.stack);
    }
}

test();
