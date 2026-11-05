/**
 * Meeting autopilot: a minute before a call that has a video link, the island says what it is
 * about to do ("open the Meet, pause the music") with a way out, then does it on time.
 * Off until the user turns it on (Settings → Calendar); the "Join" button works either way.
 */

export type AutopilotConfig = { meetings: boolean };
export type JoinableEvent = { id: string; title: string; link?: string | null; start: number; end: number; allDay: boolean };

export const AUTOPILOT_KEY = "nimbo-autopilot";
/** The heads-up comes this long before the call; joining happens a few seconds before it starts. */
export const HEADS_UP_MS = 60_000;
export const JOIN_EARLY_MS = 10_000;

export function loadAutopilot(storage: Pick<Storage, "getItem"> = window.localStorage): AutopilotConfig {
  try {
    const value = JSON.parse(storage.getItem(AUTOPILOT_KEY) ?? "null");
    return { meetings: value?.meetings === true };
  } catch {
    return { meetings: false };
  }
}

export function saveAutopilot(config: AutopilotConfig, storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(AUTOPILOT_KEY, JSON.stringify(config));
  } catch {
    // Kept for this session only.
  }
}

/** Only https links (the calendar already keeps just known video-call hosts). */
export function joinLink(event: Pick<JoinableEvent, "link"> | null | undefined) {
  const link = event?.link ?? null;
  return link && /^https:\/\/[^\s]+$/i.test(link) ? link : null;
}

/** The call to get ready for: has a link, starts within the heads-up window, not handled yet. */
export function nextCall(events: JoinableEvent[], now: number, handled: ReadonlySet<string>) {
  return (
    events
      .filter((event) => !event.allDay && joinLink(event) && !handled.has(event.id))
      .filter((event) => event.start - now <= HEADS_UP_MS && event.start - now > -2 * 60_000 && event.end > now)
      .sort((a, b) => a.start - b.start)[0] ?? null
  );
}

/** How long until it is time to join (never negative). */
export function joinDelay(event: Pick<JoinableEvent, "start">, now: number) {
  return Math.max(0, event.start - JOIN_EARLY_MS - now);
}
