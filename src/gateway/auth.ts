// Verification goes through the Auth API (getUser) because the project exposes
// the publishable key, not the JWT signing secret, so local HS256 verification
// is not available; the API call validates the token server-side.

import { createClient } from "@supabase/supabase-js";
import { config } from "../config/env.ts";

const authClient = createClient(config.supabase.url, config.supabase.key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function verifyAccessToken(token: string): Promise<string | null> {
  if (!token) return null;
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
