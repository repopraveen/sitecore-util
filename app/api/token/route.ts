import { jsonError, upstreamError } from "@/lib/server";

export const runtime = "nodejs";

const AUTH_HOST = process.env.SITECORE_AUTH_HOST || "auth.sitecorecloud.io";

/**
 * Exchanges environment client credentials for an OAuth access token.
 * Body: { clientId: string, clientSecret: string }
 * Returns: { accessToken: string, expiresIn: number }
 */
export async function POST(req: Request) {
  let body: { clientId?: string; clientSecret?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { clientId, clientSecret } = body;
  if (!clientId || !clientSecret) {
    return jsonError("clientId and clientSecret are required", 400);
  }

  const res = await fetch(`https://${AUTH_HOST}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      audience: "https://api.sitecorecloud.io",
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });

  if (!res.ok) return upstreamError(res, "Token request");

  const data = await res.json();
  return Response.json({ accessToken: data.access_token, expiresIn: data.expires_in });
}
