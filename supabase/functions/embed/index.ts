// Supabase Edge Function: free 384-dim embeddings with the built-in gte-small model.
// Deploy: supabase functions deploy embed
// Request:  POST { "input": ["text", ...] }   Response: { "embeddings": [[...384 floats], ...] }

// @ts-ignore Supabase global in the Edge runtime
const session = new Supabase.ai.Session("gte-small");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const { input } = (await req.json()) as { input: string[] };
  if (!Array.isArray(input) || input.length === 0 || input.length > 64) {
    return new Response("input must be an array of 1-64 strings", { status: 400 });
  }
  const embeddings: number[][] = [];
  for (const text of input) {
    embeddings.push((await session.run(String(text).slice(0, 2000), { mean_pool: true, normalize: true })) as number[]);
  }
  return Response.json({ embeddings });
});
