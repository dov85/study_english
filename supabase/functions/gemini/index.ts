// Supabase Edge Function — Gemini proxy
//
// Why this exists: the app is a static site on GitHub Pages, so anything it holds is public.
// The Gemini key used to live in the `app_config` table, which the browser read with the
// publishable key — meaning the key was one REST call away for anyone who opened the source.
// Here the key is a function secret. It never reaches the browser and can be rotated without
// touching the client.
//
// Deploy:
//   supabase secrets set GEMINI_API_KEY=your-key
//   supabase functions deploy gemini
//
// The proxy forwards Google's status code and body verbatim, because the client relies on
// 429/503 and the retryDelay field to drive its model fallback.

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// Only models the app actually uses. Without this the proxy would happily bill the key for
// anything a caller names.
const ALLOWED_MODELS = new Set([
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
]);

const MAX_BODY_BYTES = 100_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: { message: "Use POST." } }, 405);
  }
  if (!GEMINI_API_KEY) {
    return json(
      { error: { message: "GEMINI_API_KEY secret is not set on this function." } },
      500,
    );
  }

  const model = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!ALLOWED_MODELS.has(model)) {
    return json(
      { error: { message: `Model '${model}' is not allowed by this proxy.` } },
      400,
    );
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return json({ error: { message: "Request body too large." } }, 413);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${GEMINI_ENDPOINT}/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
  } catch (err) {
    return json({ error: { message: `Upstream request failed: ${err}` } }, 502);
  }

  // Pass the response through unchanged — the client parses Google's error shape, including
  // retryDelay, to decide whether to retry this model or fail over to the next one.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
