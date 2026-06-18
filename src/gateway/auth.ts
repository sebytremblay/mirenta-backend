// Session verification for the human auth path (D18). The gateway never trusts a
// client-asserted identity: it verifies the bearer token with Supabase Auth and
// reads the user id from the verified result, then resolves the org from
// membership. Verification goes through the Auth API (getUser) because the
// project exposes the publishable key, not the JWT signing secret, so local HS256
// verification is not available; the API call validates the token server-side.

import { createClient } from "@supabase/supabase-js";
import { config } from "../config/env.ts";

// A dedicated client for token verification. Stateless, no session persistence.
const authClient = createClient(config.supabase.url, config.supabase.key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Return the verified user id for a Supabase access token, or null when the token
// is missing, expired, or invalid.
export async function verifyAccessToken(token: string): Promise<string | null> {
  if (!token) return null;
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
