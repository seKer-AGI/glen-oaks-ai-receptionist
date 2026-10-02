export const PRACTICE_NAME = "Glen Oaks Dental Professionals";
export const MAX_RESPONSE_WORDS = 20;
export const GREETING =
  "Hi, thanks for calling Glen Oaks Dental Professionals. How can I help?";

export const SPOKEN = {
  completed: "Thank you. We'll reach out to you shortly.",
  didntCatch: "I didn't catch that. Could you repeat?",
  connection: "I'm having trouble connecting. Please try again.",
  dbError: "Please try again in a moment.",
  noInfo: "I can have our team provide that information.",
  hold: "Of course, take your time.",
  here: "Yes, I'm here. How can I help?",
  stillThere: "Are you still there?",
  stillHere: "I'm still here whenever you're ready.",
  emergency:
    "We offer emergency appointments. Please call us directly, Glen Oaks at 718-343-7700.",
} as const;

export const env = {
  openaiKey: () => process.env.OPENAI_API_KEY ?? "",
  chatModel: () => process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
  sttModel: () => process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe",
  ttsModel: () => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  ttsVoice: () => process.env.OPENAI_TTS_VOICE || "coral",
  databaseUrl: () => process.env.DATABASE_URL ?? "",
  adminPassword: () => process.env.ADMIN_PASSWORD ?? "",
  sessionSecret: () => process.env.SESSION_SECRET ?? "",
  isProd: () => process.env.NODE_ENV === "production",
};

export class ConfigError extends Error {}
