/**
 * Jarvis API Controller
 * Endpoints for personality analysis and clone features.
 */

import { Router, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { analyzePersonality } from "../services/personalityAnalyzer.service";

export const jarvisRouter = Router();

const HMAC_SALT = "ghl-wa-gateway-audit";

// Auth: dedicated JARVIS_API_KEY — timing-safe comparison prevents timing attacks
function isAuthorized(req: Request): boolean {
  const provided = req.headers["x-jarvis-key"] as string;
  const expected = process.env.JARVIS_API_KEY;
  if (!provided || !expected) return false;
  const a = createHmac("sha256", HMAC_SALT).update(provided).digest();
  const b = createHmac("sha256", HMAC_SALT).update(expected).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

// Rate limit: 1 call per 5 minutes
let lastAnalysisTime = 0;
const ANALYSIS_COOLDOWN_MS = 5 * 60 * 1000;

jarvisRouter.post(
  "/analyze-personality",
  async (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const now = Date.now();
    if (now - lastAnalysisTime < ANALYSIS_COOLDOWN_MS) {
      const waitSec = Math.ceil(
        (ANALYSIS_COOLDOWN_MS - (now - lastAnalysisTime)) / 1000,
      );
      return res
        .status(429)
        .json({ success: false, error: `Rate limited. Retry in ${waitSec}s` });
    }

    try {
      lastAnalysisTime = now;
      const profile = await analyzePersonality();
      return res.json({ success: true, profile });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
);
