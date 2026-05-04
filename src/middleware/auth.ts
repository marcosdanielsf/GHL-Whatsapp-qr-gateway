import { logger } from "../utils/logger";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";

dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

// Supabase service role client — usado apenas para log_api_key_attempt RPC
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseService = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// HMAC salt para ofuscar chaves nos logs de auditoria
const HMAC_SALT = "ghl-wa-gateway-audit";

/** Compara chaves em tempo constante — previne timing attacks */
function timingSafeKeyCompare(provided: string, expected: string): boolean {
  const a = createHmac("sha256", HMAC_SALT).update(provided).digest();
  const b = createHmac("sha256", HMAC_SALT).update(expected).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Log de tentativa + rate limiting via RPC Supabase */
async function auditKeyAttempt(
  success: boolean,
  sourceIp: string,
  keyHmac: string,
): Promise<boolean> {
  if (!supabaseService) return true; // sem service key → skip audit, não bloqueia
  try {
    const { data } = await supabaseService.rpc("log_api_key_attempt", {
      p_success: success,
      p_source_ip: sourceIp,
      p_key_hmac: keyHmac,
    });
    return data !== "blocked";
  } catch {
    logger.warn(
      "[AUTH] RPC log_api_key_attempt falhou — continuando sem audit",
    );
    return true; // falha do RPC não deve bloquear a requisição legítima
  }
}

// Extended Request interface to include user info
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
  tenantId?: string;
}

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  // Admin API key bypass (for AI Factory integration)
  const jarvisKey = req.headers["x-jarvis-key"] as string;
  const expectedKey = process.env.JARVIS_API_KEY;

  if (jarvisKey && expectedKey) {
    const valid = timingSafeKeyCompare(jarvisKey, expectedKey);
    const sourceIp = req.ip || req.socket?.remoteAddress || "";
    const keyHmac = createHmac("sha256", HMAC_SALT)
      .update(jarvisKey)
      .digest("hex");

    const allowed = await auditKeyAttempt(valid, sourceIp, keyHmac);

    if (!allowed) {
      return res
        .status(429)
        .json({ error: "Too many invalid attempts. Try again later." });
    }

    if (valid) {
      const adminTenant = process.env.JARVIS_ADMIN_TENANT_ID || "";
      req.user = {
        id: "jarvis-admin",
        email: "jarvis@mottivme.com",
        role: "admin",
      };
      req.tenantId = adminTenant;
      return next();
    }
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Missing authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Get extended user profile with tenant_id (attach user's JWT to honor RLS)
    const authed = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userProfile, error: profileError } = await authed
      .from("ghl_wa_users")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !userProfile) {
      // Fallback for initial setup or if profile doesn't exist yet
      logger.warn(`User profile not found for ${user.id}`);
      req.user = { id: user.id, email: user.email };
      return next();
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: userProfile.role,
    };
    req.tenantId = userProfile.tenant_id;

    next();
  } catch (err) {
    logger.error("Auth middleware error:", err);
    res
      .status(500)
      .json({ error: "Internal server error during authentication" });
  }
};
