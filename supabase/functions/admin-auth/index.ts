import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Status } from 'https://deno.land/std@0.224.0/http/http_status.ts';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const encoder = new TextEncoder();

interface AdminCredential {
  username: string;
  password: string;
  user_id: string;
  role?: string;
}

type CredentialRecord = {
  username: string;
  password: string;
  userId: string;
  role: string;
};

const loadCredentials = (): Map<string, CredentialRecord> => {
  const raw = Deno.env.get('admin_credentials');
  if (!raw) {
    throw new Error('admin_credentials secret is not configured');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse admin_credentials JSON', error);
    throw new Error('admin_credentials must be valid JSON');
  }

  const credentials = new Map<string, CredentialRecord>();
  const append = (entry: AdminCredential) => {
    if (!entry || typeof entry !== 'object') return;
    const { username, password, user_id, role } = entry;
    if (typeof username !== 'string' || username.length === 0) {
      throw new Error('admin_credentials entries must include a username');
    }
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error(`admin_credentials entry for ${username} is missing a password`);
    }
    if (typeof user_id !== 'string' || user_id.length === 0) {
      throw new Error(`admin_credentials entry for ${username} is missing a user_id`);
    }
    credentials.set(username, {
      username,
      password,
      userId: user_id,
      role: typeof role === 'string' && role.length > 0 ? role : 'admin',
    });
  };

  if (Array.isArray(parsed)) {
    parsed.forEach((entry) => append(entry as AdminCredential));
  } else if (parsed && typeof parsed === 'object') {
    Object.values(parsed as Record<string, AdminCredential>).forEach((entry) => append(entry));
  } else {
    throw new Error('admin_credentials must be an object or array of credential entries');
  }

  if (credentials.size === 0) {
    throw new Error('admin_credentials is empty');
  }

  return credentials;
};

const importJwtSecret = async (): Promise<CryptoKey> => {
  const secret = Deno.env.get('JWT_SECRET');
  if (!secret || secret.length === 0) {
    throw new Error('JWT_SECRET is not configured');
  }

  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
};

const jsonResponse = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(data), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    ...init,
  });

const unauthorized = (message = 'Invalid credentials') =>
  jsonResponse({ error: message }, { status: Status.Unauthorized });

const badRequest = (message: string) => jsonResponse({ error: message }, { status: Status.BadRequest });

const serverError = (message: string) => jsonResponse({ error: message }, { status: Status.InternalServerError });

const createAccessToken = async (record: CredentialRecord, username: string) => {
  const key = await importJwtSecret();
  const expiresIn = 60 * 60 * 2; // 2 hours
  const issuedAt = Math.floor(Date.now() / 1000);

  const payload = {
    sub: record.userId,
    role: 'authenticated',
    iss: 'admin-auth',
    aud: 'authenticated',
    exp: getNumericDate(expiresIn),
    iat: issuedAt,
    app_metadata: {
      admin_role: record.role,
      admin_username: username,
    },
  };

  const accessToken = await create({ alg: 'HS256', typ: 'JWT' }, payload, key);
  return {
    accessToken,
    expiresIn,
    expiresAt: issuedAt + expiresIn,
  };
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: Status.MethodNotAllowed,
      headers: corsHeaders,
    });
  }

  let credentials: Map<string, CredentialRecord>;
  try {
    credentials = loadCredentials();
  } catch (error) {
    console.error('Failed to load admin credentials', error);
    return serverError(error instanceof Error ? error.message : 'Failed to load credentials');
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch (error) {
    console.error('Invalid JSON payload', error);
    return badRequest('Request body must be valid JSON');
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return badRequest('Username and password are required');
  }

  const record = credentials.get(username);
  if (!record || record.password !== password) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return unauthorized();
  }

  let token;
  try {
    token = await createAccessToken(record, username);
  } catch (error) {
    console.error('Failed to create admin access token', error);
    return serverError('Unable to issue access token');
  }

  const refreshToken = crypto.randomUUID();

  return jsonResponse({
    access_token: token.accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: token.expiresIn,
    expires_at: token.expiresAt,
    user: {
      id: record.userId,
      role: record.role,
      username,
    },
  });
});
