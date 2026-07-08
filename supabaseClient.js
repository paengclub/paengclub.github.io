import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://zzxlzczjseeudhwjnwdm.supabase.co";
const SUPABASE_KEY = "sb_publishable_UwqLxFbT_61qsh4YVq6cyg_WdWGPEj-";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
