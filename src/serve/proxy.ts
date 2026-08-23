export function isAllowedProxyTarget(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function forwardProxyRequest(input: {
  target: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer | string | undefined;
}): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  if (!isAllowedProxyTarget(input.target)) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ error: 'Invalid target URL' })),
    };
  }

  try {
    const upstream = await fetch(input.target, {
      method: input.method || 'GET',
      headers: input.headers,
      body: input.method && !['GET', 'HEAD'].includes(input.method.toUpperCase()) ? input.body : undefined,
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    const outHeaders: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    const contentType = upstream.headers.get('content-type');
    if (contentType) outHeaders['content-type'] = contentType;
    return { status: upstream.status, headers: outHeaders, body: responseBody };
  } catch (error) {
    return {
      status: 502,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: Buffer.from(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })),
    };
  }
}

export const CORS_PREFLIGHT_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
} as const;
