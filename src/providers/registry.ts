import type { Platform } from "../types.js";
import { InstagramBusinessDiscovery } from "./competitor/instagramBusinessDiscovery.js";
import { YouTubeCompetitorProvider } from "./competitor/youtube.js";
import { FacebookOwnProvider } from "./own/facebook.js";
import { InstagramOwnProvider } from "./own/instagram.js";
import { LinkedInOwnProvider } from "./own/linkedin.js";
import { TikTokOwnProvider } from "./own/tiktok.js";
import { YouTubeOwnProvider } from "./own/youtube.js";
import type { CompetitorProvider, OwnAnalyticsProvider } from "./types.js";

/**
 * The provider registry. A paid vendor added later registers here (e.g. a TikTok
 * competitor provider); nothing downstream changes.
 */

const own: Record<Platform, OwnAnalyticsProvider> = {
  instagram: new InstagramOwnProvider(),
  facebook: new FacebookOwnProvider(),
  tiktok: new TikTokOwnProvider(),
  youtube: new YouTubeOwnProvider(),
  linkedin: new LinkedInOwnProvider(),
};

// Week 1: free and compliant competitor data exists only for Instagram and YouTube.
const competitor: Partial<Record<Platform, CompetitorProvider>> = {
  instagram: new InstagramBusinessDiscovery(),
  youtube: new YouTubeCompetitorProvider(),
};

export function ownProvider(p: Platform): OwnAnalyticsProvider {
  return own[p];
}

export function competitorProvider(p: Platform): CompetitorProvider | undefined {
  return competitor[p];
}

export function registerOwnProvider(p: Platform, provider: OwnAnalyticsProvider): void {
  own[p] = provider;
}

export function registerCompetitorProvider(p: Platform, provider: CompetitorProvider): void {
  competitor[p] = provider;
}
