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
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authorization = request.headers.get('Authorization') || '';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, error: 'Authentication required.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: caller } = await admin
      .from('profiles')
      .select('id,is_admin,account_status')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (!caller?.is_admin || caller.account_status !== 'active') {
      return json({ ok: false, error: 'Administrator access required.' }, 403);
    }

    const payload = await request.json();
    const action = String(payload.action || '');
    const targetUserId = String(payload.userId || '');
    const now = new Date().toISOString();

    if (action === 'set_status') {
      const status = String(payload.status || '');
      if (!['active', 'rejected', 'suspended'].includes(status)) {
        return json({ ok: false, error: 'Invalid account status.' }, 400);
      }
      if (!targetUserId || targetUserId === caller.id) {
        return json({ ok: false, error: 'You cannot change the account you are using.' }, 400);
      }
      const patch: Record<string, unknown> = {
        account_status: status,
        status_note: String(payload.reason || ''),
        updated_at: now
      };
      if (status === 'active') {
        patch.approved_at = now;
        patch.approved_by = caller.id;
        patch.rejected_at = null;
        patch.rejected_by = null;
        patch.status_note = '';
      } else if (status === 'rejected') {
        patch.rejected_at = now;
        patch.rejected_by = caller.id;
        patch.approved_at = null;
        patch.approved_by = null;
      }
      const { error } = await admin.from('profiles').update(patch).eq('id', targetUserId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'reset_password') {
      const password = String(payload.password || '');
      if (!targetUserId || password.length < 8 || password.length > 64) {
        return json({ ok: false, error: 'Temporary password must contain 8-64 characters.' }, 400);
      }
      const { error: authError } = await admin.auth.admin.updateUserById(targetUserId, { password });
      if (authError) throw authError;
      const { error: profileError } = await admin
        .from('profiles')
        .update({ must_change_password: true, updated_at: now })
        .eq('id', targetUserId);
      if (profileError) throw profileError;
      return json({ ok: true });
    }

    if (action === 'delete_user') {
      if (!targetUserId || targetUserId === caller.id) {
        return json({ ok: false, error: 'You cannot delete the account you are using.' }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(targetUserId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'hard_reset') {
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (error) throw error;
        const users = data.users || [];
        if (!users.length) break;
        for (const user of users) {
          const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
          if (deleteError) throw deleteError;
        }
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown admin action.' }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : 'Admin action failed.' }, 500);
  }
});
