const EMERGENCY_PATTERNS: RegExp[] = [
  /\bemergenc(y|ies)\b/i,
  /\burgent(ly)?\b/i,
  /\b(severe|terrible|unbearable|horrible|excruciating|intense|bad)\b.{0,20}\b(tooth|teeth|dental|jaw)?\s*(pain|ache|toothache)\b/i,
  /\b(knocked|knock)(ed)?[\s-]*out\b/i,
  /\b(tooth|teeth)\b.{0,25}\b(fell|came|popped)\s+out\b/i,
  /\b(swelling|swollen|swelled)\b/i,
  /\bbleeding\b/i,
  /\b(dental )?trauma\b/i,
  /\babscess\b/i,
];

export function isEmergency(text: string): boolean {
  return EMERGENCY_PATTERNS.some((p) => p.test(text));
}
