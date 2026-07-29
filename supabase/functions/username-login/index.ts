import { createClient } from 'npm:@supabase/supabase-js@2.110.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const { username, password } = await request.json();
    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername) || cleanPassword.length < 8) {
      return json({ error: 'Username/email or password is incorrect.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('email')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (profileError || !profile?.email) {
      return json({ error: 'Username/email or password is incorrect.' }, 400);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password: cleanPassword
    });

    if (error || !data.session) {
      return json({ error: 'Username/email or password is incorrect.' }, 400);
    }

    return json({ session: data.session });
  } catch (error) {
    console.error(error);
    return json({ error: 'Login could not be completed.' }, 500);
  }
});
