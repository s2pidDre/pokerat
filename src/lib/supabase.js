import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.7/+esm';

const SUPABASE_URL = 'https://lndrrhjfzernwoqshrmk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_A_MoSZumVFCyuzEAppsMIQ_gyl6FW26';
const REMEMBER_KEY = 'pokerat-supabase-remember';

function selectedStorage() {
  return localStorage.getItem(REMEMBER_KEY) === '1' ? localStorage : sessionStorage;
}

function oppositeStorage() {
  return selectedStorage() === localStorage ? sessionStorage : localStorage;
}

const hybridStorage = {
  getItem(key) {
    return selectedStorage().getItem(key) ?? oppositeStorage().getItem(key);
  },
  setItem(key, value) {
    selectedStorage().setItem(key, value);
    oppositeStorage().removeItem(key);
  },
  removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: hybridStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
});

export function setRememberPreference(remember) {
  if (remember) localStorage.setItem(REMEMBER_KEY, '1');
  else localStorage.removeItem(REMEMBER_KEY);
}

export function getRememberPreference() {
  return localStorage.getItem(REMEMBER_KEY) === '1';
}

export function clearRememberPreference() {
  localStorage.removeItem(REMEMBER_KEY);
}

export const supabaseConfig = Object.freeze({
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY
});
