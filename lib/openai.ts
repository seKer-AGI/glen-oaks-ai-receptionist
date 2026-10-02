import OpenAI, { toFile } from "openai";
import { ConfigError, env } from "./config";
import type { LlmClient, LlmRequest, LlmResponse } from "./receptionist";

const g = globalThis as unknown as { __openai?: OpenAI };

export function getOpenAI(): OpenAI {
  const apiKey = env.openaiKey();
  if (!apiKey) throw new ConfigError("OPENAI_API_KEY is not set");
  return (g.__openai ??= new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 }));
}

export function isOpenAIConfigured(): boolean {
  return Boolean(env.openaiKey());
}

export const openAiLlm: LlmClient = {
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await getOpenAI().chat.completions.create({
      model: env.chatModel(),
      messages: req.messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: req.tools as OpenAI.Chat.ChatCompletionTool[] | undefined,
      tool_choice: req.tools ? req.toolChoice ?? "auto" : undefined,
      temperature: 0.3,
      max_tokens: 120,
    });
    const msg = res.choices[0]?.message;
    return {
      content: msg?.content ?? null,
      toolCalls: (msg?.tool_calls ?? [])
        .filter((c) => c.type === "function")
        .map((c) => ({
          id: c.id,
          name: (c as { function: { name: string } }).function.name,
          arguments: (c as { function: { arguments: string } }).function.arguments,
        })),
    };
  },
};

export async function transcribe(audio: Buffer, filename: string, mime: string): Promise<string> {
  const res = await getOpenAI().audio.transcriptions.create({
    file: await toFile(audio, filename, { type: mime }),
    model: env.sttModel(),
    language: "en",
    prompt:
      "A patient on the phone with a dental office. Names, street addresses, phone numbers, dates, dental terms like Invisalign, implants.",
  });
  return res.text.trim();
}

const VOICE_STYLE =
  "Speak as a warm, calm, friendly dental office receptionist on the phone. Natural conversational pace, brief and professional.";

async function speechResponse(text: string) {
  const model = env.ttsModel();
  return getOpenAI().audio.speech.create({
    model,
    voice: env.ttsVoice() as "coral",
    input: text,
    response_format: "mp3",
    ...(model.startsWith("gpt-4o") ? { instructions: VOICE_STYLE } : {}),
  });
}

export async function synthesize(text: string): Promise<Buffer> {
  return Buffer.from(await (await speechResponse(text)).arrayBuffer());
}

/** Yields mp3 bytes as OpenAI produces them so playback can begin before synthesis finishes. */
export async function* synthesizeStream(text: string): AsyncGenerator<Buffer> {
  const res = await speechResponse(text);
  if (!res.body) {
    yield Buffer.from(await res.arrayBuffer());
    return;
  }
  // The SDK's body is a Node Readable (or a web stream); both are async-iterable.
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    if (chunk.length) yield Buffer.from(chunk);
  }
}
