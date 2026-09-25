/**
 * Every CTA link carries the brief_id in its UTM tags, so link clicks trace back to
 * the idea with free analytics tools.
 */
export function withUtm(url: string, p: { platform: string; briefId: string; ideaId: string }): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", p.platform);
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", p.briefId);
  u.searchParams.set("utm_content", p.ideaId);
  return u.toString();
}
