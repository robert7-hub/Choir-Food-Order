// ⚙️  PASTE YOUR PROJECT VALUES HERE (Supabase → Project Settings → API).
// The anon/public key is SAFE to ship in the browser — Row Level Security
// (see supabase/schema.sql) is what actually protects the data.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://qpbtmxypfzoroudjpvkj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwYnRteHlwZnpvcm91ZGpwdmtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMzE1NjksImV4cCI6MjA5NjYwNzU2OX0.VvE20IcZArq2wANcE94QPEhEQssuGuLKjbeXw615u_c';

function hasRealConfig(url, key){
  if(!url || !key) return false;
  if(url.includes('YOUR-PROJECT') || key.includes('YOUR-ANON')) return false;
  return /^https:\/\/.+\.supabase\.co$/i.test(url);
}

export const isSupabaseConfigured = hasRealConfig(SUPABASE_URL, SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
