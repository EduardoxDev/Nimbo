const DISTRACTIONS: [RegExp, string][] = [
  [/youtube/i, "YouTube"],
  [/instagram/i, "Instagram"],
  [/tiktok/i, "TikTok"],
  [/\b(twitter|x\.com)\b|\/ x$/i, "X"],
  [/netflix/i, "Netflix"],
  [/reddit/i, "Reddit"],
  [/facebook/i, "Facebook"],
  [/twitch/i, "Twitch"],
  [/prime video/i, "Prime Video"],
  [/disney\+/i, "Disney+"],
];

export function distractionOf(title: string, app: string): string | null {
  if (/^steam(webhelper)?\.exe$/i.test(app)) return "Steam";
  return DISTRACTIONS.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}
