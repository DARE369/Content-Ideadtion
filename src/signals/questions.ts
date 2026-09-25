/**
 * Cheap, language-tolerant question detection for comments. Anything that
 * passes is later clustered by Claude; this only keeps obvious noise out.
 */
const QUESTION_WORDS =
  /\b(how|what|why|when|where|which|who|can|could|should|would|is|are|do|does|did|any|anyone|pls|please|abeg|cómo|qué|por qué|comment|pourquoi|wie|was|warum)\b/i;

export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (/[?？¿]/.test(t)) return true;
  return QUESTION_WORDS.test(t.split(/\s+/).slice(0, 4).join(" ")) && t.split(/\s+/).length >= 4;
}
