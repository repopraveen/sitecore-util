/**
 * Server-side helpers for the API proxy routes.
 *
 * The browser cannot call Sitecore CM hosts directly (CORS), so every call is
 * relayed through these Next.js route handlers. To avoid acting as an open
 * proxy, hosts are validated against an allowlist of domain suffixes.
 */

const DEFAULT_ALLOWED_SUFFIXES = [".sitecorecloud.io", ".sitecore.io"];

export function allowedSuffixes(): string[] {
  const env = process.env.ALLOWED_HOST_SUFFIXES;
  if (env && env.trim()) {
    return env.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_SUFFIXES;
}

/**
 * Validates a user-supplied host and returns a normalized origin
 * (e.g. "https://xmc-org-proj-env.sitecorecloud.io"). Throws on anything
 * that is not an https host matching the allowlist.
 */
export function normalizeHost(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error(`Invalid host: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("Only https hosts are allowed.");
  }
  const ok = allowedSuffixes().some((suffix) => url.hostname.endsWith(suffix));
  if (!ok) {
    throw new Error(
      `Host ${url.hostname} is not in the allowlist (${allowedSuffixes().join(", ")}). ` +
        "Set ALLOWED_HOST_SUFFIXES to override."
    );
  }
  return url.origin;
}

export function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function jsonError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status });
}

/** Reads the response body as text and produces a useful error message. */
export async function upstreamError(res: Response, context: string): Promise<Response> {
  let detail = "";
  try {
    const text = (await res.text()).trim();
    // Gateway/CM error pages are HTML — useless noise in an error message.
    detail = text.startsWith("<") ? "(HTML error page returned by the server)" : text.slice(0, 300);
  } catch {
    /* ignore */
  }
  return jsonError(`${context} failed (${res.status} ${res.statusText}) ${detail}`.trim(), 502);
}
