/**
 * Versioned per-platform playbooks (reviewed monthly). Kept as a module rather
 * than JSON files read from disk so serverless bundles always include them.
 */
export const PLAYBOOK_DATA = {
  "facebook": {
    "platform": "facebook",
    "version": "2026-09-24",
    "reviewed_at": "2026-09-24",
    "design_for": [
      "Reels reach",
      "early engagement in the first 60-90 minutes"
    ],
    "default_format": "reel",
    "formats": [
      "reel",
      "native_video",
      "image_post",
      "text_post"
    ],
    "length_seconds": [
      15,
      90
    ],
    "aspect_ratio": "9:16",
    "hook": "Same as Reels, with a warmer, more conversational tone.",
    "caption": "Group-friendly framing; ask a question people want to answer.",
    "cta": [
      "question",
      "comment",
      "share"
    ],
    "default_cta": "question",
    "ranking_signals": [
      "early comments",
      "shares",
      "watch time"
    ],
    "do_not": [
      "post external links in the first line",
      "engagement bait (\"like if...\")"
    ],
    "notes": "Post at the audience's peak hour; the first 60-90 minutes decide distribution."
  },
  "instagram": {
    "platform": "instagram",
    "version": "2026-09-24",
    "reviewed_at": "2026-09-24",
    "design_for": [
      "DM sends",
      "watch time",
      "saves"
    ],
    "default_format": "reel",
    "formats": [
      "reel",
      "carousel",
      "single_image"
    ],
    "length_seconds": [
      7,
      90
    ],
    "aspect_ratio": "9:16",
    "format_aspect_ratios": {
      "reel": "9:16",
      "carousel": "4:5",
      "single_image": "4:5"
    },
    "hook": "Visual hook in the first second; say the keywords out loud (audio is indexed).",
    "caption": "Lead with the value; include spoken keywords; 3-5 relevant hashtags at most.",
    "cta": [
      "share",
      "save",
      "dm",
      "link_in_bio"
    ],
    "default_cta": "share",
    "cta_phrasing": "\"Send this to someone who...\" or \"Save this for later\"",
    "ranking_signals": [
      "DM sends",
      "watch time",
      "saves",
      "likes per reach"
    ],
    "do_not": [
      "post reels over 90 seconds",
      "use watermarked video from other apps"
    ],
    "notes": "Reels get more reach than carousels; use a carousel when the goal is saves."
  },
  "linkedin": {
    "platform": "linkedin",
    "version": "2026-09-24",
    "reviewed_at": "2026-09-24",
    "design_for": [
      "dwell on the first 3 lines",
      "comments",
      "saves"
    ],
    "default_format": "document_carousel",
    "formats": [
      "document_carousel",
      "text_post",
      "talking_head_video"
    ],
    "length_seconds": null,
    "aspect_ratio": "4:5",
    "format_aspect_ratios": {
      "document_carousel": "4:5",
      "text_post": "1.91:1",
      "talking_head_video": "4:5"
    },
    "hook": "Put the insight in the first 3 lines, before \"see more\".",
    "caption": "Plain, expert voice; few or no hashtags.",
    "cta": [
      "question"
    ],
    "default_cta": "question",
    "cta_phrasing": "Close with a question only an expert in the audience can answer.",
    "ranking_signals": [
      "dwell time",
      "comments",
      "saves",
      "sends"
    ],
    "do_not": [
      "more than 3 hashtags",
      "external link in the post body",
      "engagement pods"
    ]
  },
  "tiktok": {
    "platform": "tiktok",
    "version": "2026-09-24",
    "reviewed_at": "2026-09-24",
    "design_for": [
      "completion",
      "re-watch"
    ],
    "default_format": "vertical_video",
    "formats": [
      "vertical_video",
      "photo_carousel"
    ],
    "length_seconds": [
      15,
      45
    ],
    "aspect_ratio": "9:16",
    "hook": "Promise the payoff in the first 1-2 seconds; no intro, no logo.",
    "caption": "Short, with searchable keywords people would type into TikTok search.",
    "cta": [
      "comment"
    ],
    "default_cta": "comment",
    "ranking_signals": [
      "completion rate",
      "re-watches",
      "shares",
      "comments"
    ],
    "do_not": [
      "open with a logo or brand intro",
      "bury the payoff after 3 seconds",
      "use more than 5 hashtags"
    ]
  },
  "youtube": {
    "platform": "youtube",
    "version": "2026-09-24",
    "reviewed_at": "2026-09-24",
    "design_for": [
      "title promise matched by watch time"
    ],
    "default_format": "short",
    "formats": [
      "short",
      "long_form"
    ],
    "length_seconds": [
      20,
      180
    ],
    "aspect_ratio": "9:16",
    "format_aspect_ratios": {
      "short": "9:16",
      "long_form": "16:9"
    },
    "hook": "State the premise in the first 2 seconds, exactly as the title promises.",
    "caption": "Write a title and thumbnail brief first; the description links a related long video.",
    "cta": [
      "subscribe",
      "link"
    ],
    "default_cta": "subscribe",
    "ranking_signals": [
      "average view duration",
      "retention",
      "title-to-watch-time match"
    ],
    "requires": [
      "title",
      "thumbnail_brief"
    ],
    "do_not": [
      "clickbait titles the video does not pay off",
      "Shorts over 3 minutes"
    ]
  }
} as const;
