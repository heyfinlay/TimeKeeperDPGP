#!/usr/bin/env node
import { createSupabaseServerClient } from '../src/lib/supabaseServerClient.js';

const resolveSupabaseUrl = () => {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  return url.trim();
};

const resolveServiceRoleKey = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return key.trim();
};

const main = async () => {
  const supabaseUrl = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required to provision the marshal account.',
    );
  }

  const email = (process.env.DEFAULT_MARSHAL_EMAIL ?? 'marshal@example.com').trim();
  const password = process.env.DEFAULT_MARSHAL_PASSWORD?.trim();
  if (!password) {
    throw new Error('Set DEFAULT_MARSHAL_PASSWORD to provision the default marshal account.');
  }
  const displayName = (process.env.DEFAULT_MARSHAL_NAME ?? 'Default Marshal').trim();

  const client = createSupabaseServerClient({
    supabaseUrl,
    supabaseKey: serviceRoleKey,
    options: {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  });

  console.info('Provisioning default marshal account', { email, displayName });

  let userId;
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    if (error?.status === 422 || /already registered/i.test(error?.message ?? '')) {
      console.warn('Marshal user already exists, loading existing profile');
      const existing = await client.auth.admin.listUsers({
        page: 1,
        perPage: 100,
      });
      const match = existing?.data?.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase());
      if (!match) {
        throw error;
      }
      userId = match.id;
    } else {
      throw error;
    }
  } else {
    userId = data?.user?.id ?? null;
  }

  if (!userId) {
    throw new Error('Unable to determine marshal user identifier.');
  }

  const { error: profileError } = await client
    .from('profiles')
    .upsert(
      {
        id: userId,
        role: 'marshal',
        display_name: displayName,
      },
      { onConflict: 'id' },
    );

  if (profileError) {
    throw profileError;
  }

  console.info('Default marshal account ready', { userId, email });
};

main().catch((error) => {
  console.error('Failed to provision default marshal account');
  console.error(error);
  process.exitCode = 1;
});
