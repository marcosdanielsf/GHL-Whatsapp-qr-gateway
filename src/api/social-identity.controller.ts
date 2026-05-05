import { Request, Response, Router } from "express";
import { getSupabaseClient } from "../infra/supabaseClient";
import { logger } from "../utils/logger";

export const socialIdentityRouter = Router();

function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Cache-Control", "no-store");
}

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "app.socialfy.me" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".leadconnectorhq.com") ||
      hostname.endsWith(".gohighlevel.com")
    );
  } catch (_error) {
    return false;
  }
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInstagramUsername(value?: string | null): string | null {
  if (!value) return null;
  let clean = value.trim().replace(/^@+/, "");
  const match = clean.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (match) clean = match[1];
  clean = clean.split(/[/?#\s]/)[0].replace(/^@+/, "").trim();
  if (!clean || ["p", "reel", "reels", "stories", "explore", "direct", "accounts"].includes(clean.toLowerCase())) {
    return null;
  }
  return /^[a-zA-Z0-9._]{1,30}$/.test(clean) ? clean : null;
}

function buildInstagramUrl(username?: string | null, profileUrl?: string | null): string | null {
  const normalized = normalizeInstagramUsername(username || profileUrl || "");
  return normalized ? `https://instagram.com/${normalized}` : null;
}

socialIdentityRouter.options("/social-identity", (req: Request, res: Response) => {
  setCorsHeaders(req, res);
  return res.status(204).send();
});

socialIdentityRouter.get("/social-identity", async (req: Request, res: Response) => {
  setCorsHeaders(req, res);

  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ success: false, error: "Origin not allowed" });
  }

  const locationId = getString(req.query.locationId);
  const contactId = getString(req.query.contactId);

  if (!locationId || !contactId) {
    return res.status(400).json({ success: false, error: "locationId and contactId are required" });
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("growth_leads")
      .select(
        "id, name, ghl_contact_id, location_id, instagram_username, instagram_profile_url, instagram_username_source, instagram_username_confidence, instagram_username_captured_at, warmup_status, next_followup_at",
      )
      .eq("location_id", locationId)
      .eq("ghl_contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const username = normalizeInstagramUsername(data?.instagram_username || data?.instagram_profile_url || null);
    const profileUrl = buildInstagramUrl(username, data?.instagram_profile_url || null);

    return res.json({
      success: true,
      found: Boolean(data && profileUrl),
      identity: data
        ? {
            growthLeadId: data.id,
            name: data.name || null,
            locationId: data.location_id,
            contactId: data.ghl_contact_id,
            instagramUsername: username,
            instagramProfileUrl: profileUrl,
            source: data.instagram_username_source || null,
            confidence: data.instagram_username_confidence || null,
            capturedAt: data.instagram_username_captured_at || null,
            warmupStatus: data.warmup_status || null,
            nextFollowupAt: data.next_followup_at || null,
          }
        : null,
    });
  } catch (error: any) {
    logger.error("Error fetching social identity for GHL script", {
      event: "nexus.social_identity.error",
      locationId,
      contactId,
      error: error.message,
    });
    return res.status(500).json({ success: false, error: "Failed to fetch social identity" });
  }
});
