# Amazon Nova Hackathon Feedback

**Project**: AIKiosQ - Hardware Store Kiosk with Amazon Nova Sonic + Nova Lite
**Date**: 2026-02-04
**Feedback Type**: Bugs, Documentation Gaps, Model Enhancement Suggestions

---

## Executive Summary

Amazon Nova Sonic and Nova Lite are powerful models that enabled a real-time speech-to-speech kiosk with vision capabilities. However, tool calling implementation revealed significant documentation gaps and unclear error messages that resulted in **~20+ debugging iterations** over several hours. This feedback aims to help future developers avoid these issues.

---

## 🐛 Critical Bugs & Issues

### 1. Generic Error Messages for Tool Calling Validation Failures

**Issue**: Tool calling validation errors return generic "Tool Response parsing error" without indicating which field or validation failed.

**Impact**: Spent hours debugging because error didn't indicate:
- Which field was invalid (role, contentType, event type, content structure)
- What the expected value should be
- Where in the event sequence the error occurred

**Example Error**:
```
Tool Response parsing error
```

**Actual Issues** (discovered through trial-and-error):
- Missing `mediaType: "text/plain"` in `textInputConfiguration`
- Using `role: "USER"` instead of `role: "TOOL"`
- Using event type `textInput` instead of `toolResult`
- Sending plain text instead of JSON-stringified object in content

**Suggested Fix**: Provide specific validation errors like:
```
Tool Response validation error: Missing required field 'mediaType' in
'toolResultInputConfiguration.textInputConfiguration'

Tool Response validation error: Invalid role 'USER' for tool result content.
Expected 'TOOL'

Tool Response validation error: Content must be a JSON-encoded string,
received plain text
```

---

### 2. Tool Schema Validation: JSON.stringify() Requirement Not Clear

**Issue**: Tool schema `inputSchema.json` must be a stringified JSON, not a plain JavaScript object. This is not clearly documented.

**What Doesn't Work** (intuitive but wrong):
```typescript
inputSchema: {
    json: {
        type: "object",
        properties: { description: { type: "string" } }
    }
}
```

**What Works** (counterintuitive):
```typescript
inputSchema: {
    json: JSON.stringify({
        type: "object",
        properties: { description: { type: "string" } }
    })
}
```

**Error Message**: "Unable to parse input chunk"

**Suggested Fix**:
1. Add TypeScript type definition that enforces `json: string` (not `json: object`)
2. Update error message: "Unable to parse input chunk: inputSchema.json must be a JSON-stringified string, not an object"
3. Add code examples in documentation showing the JSON.stringify() requirement

---

### 3. Tool Result Content Must Be JSON Object (Undocumented)

**Issue**: Tool result content must be a JSON-stringified object, not plain text. This critical requirement is not documented in the API reference.

**What Doesn't Work**:
```typescript
content: "Here is the analysis result..."
```

**What Works**:
```typescript
content: JSON.stringify({
    result: "Here is the analysis result...",
    status: "success"
})
```

**Error**: Generic "Tool Response parsing error"

**Suggested Fix**:
1. Document this requirement explicitly in API reference
2. Provide clear error: "Tool result content must be a JSON-stringified object with at least a 'result' field"
3. Show examples in all language SDKs

---

## 📚 Documentation Gaps

### 1. Lack of TypeScript/JavaScript Examples for Tool Calling

**Issue**: The only complete working example for Nova Sonic tool calling is in Python:
https://github.com/aws-samples/amazon-nova-samples/blob/main/speech-to-speech/sample-codes/console-python/nova_sonic_tool_use.py

**Impact**:
- JavaScript/TypeScript developers must reverse-engineer from Python
- Type differences (Buffer vs bytes, object structure) cause confusion
- Took 20+ iterations to get tool calling working in TypeScript

**Suggested Fix**:
1. Add complete TypeScript/JavaScript example for Nova Sonic tool calling to amazon-nova-samples repo
2. Include browser-side AND Node.js examples (bidirectional streaming requires HTTP/2 from Node)
3. Show Socket.IO relay pattern for browser tool execution

### 2. Tool Result Event Sequence Not Clearly Documented

**Issue**: The exact sequence and structure of tool result events is not clearly documented in API reference.

**What We Learned** (after many attempts):

Tool results require THREE events in exact order:

1. **contentStart** with:
   - `type: "TOOL"`
   - `role: "TOOL"` (not USER, not ASSISTANT)
   - `toolResultInputConfiguration.toolUseId` matching the tool call
   - `toolResultInputConfiguration.type: "TEXT"`
   - `toolResultInputConfiguration.textInputConfiguration.mediaType: "text/plain"`

2. **toolResult** with:
   - `promptName` (matching session)
   - `contentName` (unique ID for this tool result)
   - `content` (JSON-stringified object)

3. **contentEnd** with:
   - `promptName` (matching)
   - `contentName` (matching)

**Suggested Fix**:
1. Add "Tool Result Event Sequence" section to API documentation
2. Include complete event structure examples with all required fields
3. Add sequence diagram showing event flow

### 3. Event Timing Requirements Not Documented

**Issue**: Not clear WHEN to execute tools during the event stream.

**What We Learned**:
- DO NOT execute tools immediately on `toolUse` event
- MUST wait for `contentEnd` event with `type: "TOOL"`
- Tool metadata arrives across multiple events (`contentStart`, `toolUse`) and must be accumulated

**Suggested Fix**: Document the tool execution lifecycle:
```
1. contentStart (type: TOOL) → store toolUseId, toolName
2. toolUse → store content (JSON arguments)
3. contentEnd (type: TOOL) → NOW execute tool with accumulated data
4. Send tool result back to stream
```

---

## 🚀 Model Enhancement Suggestions

### 1. Nova Sonic: Tool Trigger Sensitivity

**Observation**: Nova Sonic sometimes requires very specific phrasing to trigger tools.

**Example**:
- "Here it is" → Sometimes triggers `analyze_part` ✓
- "Take a look at this" → Sometimes triggers ✓
- "Can you identify this?" → Sometimes doesn't trigger ✗

**Suggestion**: Improve natural language understanding for tool triggering across more conversational phrasings.

### 2. Nova Sonic: Tool Call Confidence Scores

**Enhancement**: Add confidence scores to tool calls so applications can:
- Ask for clarification when confidence is low
- Show "Did you want to...?" prompts to user
- Log confidence for analytics

**Example Response**:
```json
{
    "toolUse": {
        "toolName": "analyze_part",
        "toolUseId": "...",
        "confidence": 0.87,
        "alternatives": [
            { "tool": "check_inventory", "confidence": 0.45 }
        ]
    }
}
```

### 3. Nova Lite: Image Quality Recommendations

**Observation**: Nova Lite 2 performs well with high-resolution images (640x480+) but this isn't documented.

**Suggestion**: Add guidance in documentation:
- Recommended minimum resolution for part identification: 640x480
- Optimal resolution: 1280x720
- Impact of lighting conditions
- JPEG quality recommendations (we use 0.95)

### 4. Nova Sonic: Streaming Latency Metrics

**Enhancement**: Expose latency metrics for monitoring:
- Time from audio input to transcription
- Time from tool completion to audio response
- Audio chunk processing time

**Use Case**: Helps optimize kiosk experience and identify performance bottlenecks.

---

## ✅ What Worked Well (Positive Feedback)

### 1. Nova Sonic Audio Quality
- **Excellent** speech synthesis quality with "matthew" voice
- Natural conversational flow
- 24kHz output provides clear, professional sound

### 2. Nova Lite Vision Accuracy
- Accurately identified plumbing parts with 95%+ success rate
- Good understanding of technical terminology (threads, compression fittings, etc.)
- Useful multi-modal input (image + text prompt)

### 3. Bidirectional Streaming Architecture
- HTTP/2 streaming design is performant
- Event-based model allows real-time interaction
- Tool calling integration is powerful once working

### 4. AWS SDK Integration
- `@aws-sdk/client-bedrock-runtime` works well in Node.js
- `@smithy/node-http-handler` provides good HTTP/2 support
- Credential management is straightforward

---

## 📊 Development Time Breakdown

**Total Development Time**: ~8 hours
**Time on Tool Calling Debug**: ~4 hours (50% of development!)

**What caused delays**:
- Generic error messages: 2 hours
- Finding Python reference sample: 0.5 hours
- Trial-and-error field requirements: 1 hour
- JSON stringification issues: 0.5 hours

**What went smoothly**:
- Basic audio streaming setup: 1 hour
- Nova Lite integration: 0.5 hours
- UI/UX implementation: 2 hours

---

## 🎯 Recommended Actions for Amazon Team

### High Priority
1. **Improve error messages** for tool calling validation (biggest time saver)
2. **Add TypeScript/JavaScript examples** to amazon-nova-samples repo
3. **Document tool result content JSON requirement** explicitly

### Medium Priority
4. Add tool execution timing/sequence documentation
5. Add API reference section specifically for tool calling
6. Improve tool trigger sensitivity in Nova Sonic

### Low Priority
7. Add confidence scores to tool calls
8. Expose latency metrics for monitoring
9. Add image quality guidelines for Nova Lite

---

## 📝 Additional Context

**GitHub Issues Consulted**:
- https://github.com/aws-samples/amazon-nova-samples/issues
- https://repost.aws/search (nova sonic queries)

**Reference Sample Used**:
- https://github.com/aws-samples/amazon-nova-samples/blob/main/speech-to-speech/sample-codes/console-python/nova_sonic_tool_use.py

**Tech Stack**:
- React + TypeScript (browser)
- Express + Socket.IO (Node.js server)
- Amazon Nova Sonic (`amazon.nova-2-sonic-v1:0`)
- Amazon Nova Lite 2 (`us.amazon.nova-2-lite-v1:0`)

---

## Contact for Follow-up

If the Amazon Bedrock team would like to discuss any of this feedback or see our implementation, we're happy to provide:
- Complete codebase access
- Screen recordings of the debugging process
- Live demo of the working application
- Detailed logs from debugging sessions

Thank you for this opportunity to work with Amazon Nova models!
