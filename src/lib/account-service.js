import { normalizeEmail, normalizeLoginIdentifier, normalizeUsername, validateDisplayName, validateEmail, validatePassword, validateUsername } from '../utils/auth.js';
import { clearRememberPreference, setRememberPreference, supabase } from './supabase.js';

let profileChannel = null;

async function edgeFunctionError(error, fallback) {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return new Error(body.error);
  } catch { /* Use fallback below. */ }
  return new Error(error?.message || fallback);
}

export function mapProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    display_name: profile.display_name || profile.username || 'Player',
    login_name: profile.username || '',
    email: profile.email || '',
    account_status: profile.account_status || 'pending',
    is_admin: Boolean(profile.is_admin),
    password_salt: '',
    password_hash: '',
    password_format: 'supabase',
    must_change_password: Boolean(profile.must_change_password),
    status_note: profile.status_note || '',
    approved_at: profile.approved_at || null,
    approved_by: profile.approved_by || null,
    rejected_at: profile.rejected_at || null,
    rejected_by: profile.rejected_by || null,
    last_login_at: profile.last_login_at || null,
    display_name_changed_at: profile.display_name_changed_at || null,
    created_at: profile.created_at || new Date().toISOString()
  };
}

function assertAuthInput({ username, email, password, confirmPassword }) {
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);
  const emailError = validateEmail(email);
  if (emailError) throw new Error(emailError);
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  if (password !== confirmPassword) throw new Error('The passwords do not match.');
}

export async function hasActiveAdministrator() {
  const { data, error } = await supabase.rpc('has_active_admin');
  if (error) throw error;
  return Boolean(data);
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export async function getCurrentProfile(retries = 5) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userData.user.id).maybeSingle();
    if (error) throw error;
    if (data) return mapProfile(data);
    await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
  }
  return null;
}

export async function getVisibleProfiles(currentProfile) {
  if (!currentProfile) return [];
  const query = supabase.from('profiles').select('*').order('created_at', { ascending: true });
  const { data, error } = currentProfile.is_admin ? await query : await query.eq('id', currentProfile.id);
  if (error) throw error;
  return (data || []).map(mapProfile);
}

export async function createFirstAdministrator({ username, email, password, confirmPassword }) {
  assertAuthInput({ username, email, password, confirmPassword });
  setRememberPreference(true);
  const cleanUsername = normalizeUsername(username);
  const cleanEmail = normalizeEmail(email);
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { username: cleanUsername, display_name: cleanUsername } }
  });
  if (error) throw error;
  if (!data.session) throw new Error('Email confirmation is enabled. Disable Confirm email during testing, then try again.');
  const { error: bootstrapError } = await supabase.rpc('bootstrap_first_admin');
  if (bootstrapError) {
    await supabase.auth.signOut();
    throw bootstrapError;
  }
  return getCurrentProfile();
}

export async function registerAccount({ username, email, password, confirmPassword }) {
  assertAuthInput({ username, email, password, confirmPassword });
  setRememberPreference(false);
  const cleanUsername = normalizeUsername(username);
  const cleanEmail = normalizeEmail(email);
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { username: cleanUsername, display_name: cleanUsername } }
  });
  if (error) throw error;
  if (!data.session) {
    return { profile: null, needsEmailConfirmation: true };
  }
  const profile = await getCurrentProfile();
  return { profile, needsEmailConfirmation: false };
}

export async function loginAccount(identifier, password, remember) {
  const cleanIdentifier = normalizeLoginIdentifier(identifier);
  if (!cleanIdentifier || !password) throw new Error('Username/email or password is incorrect.');
  setRememberPreference(Boolean(remember));

  if (cleanIdentifier.includes('@')) {
    const { error } = await supabase.auth.signInWithPassword({ email: cleanIdentifier, password });
    if (error) throw error;
  } else {
    const usernameError = validateUsername(cleanIdentifier);
    if (usernameError) throw new Error('Username/email or password is incorrect.');
    const { data, error } = await supabase.functions.invoke('username-login', {
      body: { username: normalizeUsername(cleanIdentifier), password }
    });
    if (error) throw await edgeFunctionError(error, 'Username/email or password is incorrect.');
    if (!data?.session?.access_token || !data?.session?.refresh_token) {
      throw new Error(data?.error || 'Username/email or password is incorrect.');
    }
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
    if (sessionError) throw sessionError;
  }

  const profile = await getCurrentProfile();
  if (!profile) throw new Error('Your Pokerat profile could not be loaded.');
  try { await supabase.rpc('touch_last_login'); } catch { /* Non-critical. */ }
  return profile;
}

export async function logoutAccount() {
  await supabase.auth.signOut();
  clearRememberPreference();
}

export async function updateOwnProfile({ displayName }) {
  const displayError = validateDisplayName(displayName);
  if (displayError) throw new Error(displayError);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('Log in again.');
  const { error: profileError } = await supabase.rpc('update_own_profile', { p_display_name: String(displayName).trim() });
  if (profileError) throw profileError;
  return getCurrentProfile();
}

export async function changeOwnPassword({ currentPassword, password, confirmPassword }) {
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  if (password !== confirmPassword) throw new Error('The passwords do not match.');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.email) throw new Error('Log in again.');
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email: userData.user.email, password: currentPassword });
  if (verifyError) throw new Error('Current password is incorrect.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  await supabase.rpc('complete_password_change');
}

export async function completeForcedPasswordChange({ password, confirmPassword }) {
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);
  if (password !== confirmPassword) throw new Error('The passwords do not match.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  const { error: profileError } = await supabase.rpc('complete_password_change');
  if (profileError) throw profileError;
  return getCurrentProfile();
}

export async function runAdminAccountAction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('admin-account', {
    body: { action, ...payload }
  });
  if (error) throw await edgeFunctionError(error, 'Admin action failed.');
  if (!data?.ok) throw new Error(data?.error || 'Admin action failed.');
  return data;
}

export function subscribeToProfiles(onChange) {
  unsubscribeFromProfiles();
  profileChannel = supabase
    .channel('pokerat-profile-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => onChange())
    .subscribe();
  return profileChannel;
}

export function unsubscribeFromProfiles() {
  if (profileChannel) supabase.removeChannel(profileChannel);
  profileChannel = null;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(event, session));
}
