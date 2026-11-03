import type { Segment } from "../day/activity";
import type { DayLog } from "../automations/learn";
import { recentDays } from "../automations/learn";

function at(day: string, hours: number, minutes: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hours, minutes).getTime();
}

export function demoLogs(now = new Date()): DayLog[] {
  return recentDays(now).map((day, index) => {
    const [year, month, date] = day.split("-").map(Number);
    const weekday = new Date(year, month - 1, date).getDay();
    const segments: Segment[] = [];
    const add = (app: string, h1: number, m1: number, h2: number, m2: number) => segments.push({ app, title: "", start: at(day, h1, m1), end: at(day, h2, m2) });
    const jitter = (index * 7) % 11;
    if (weekday === 0 || weekday === 6) {
      add("chrome.exe", 10, 5, 11, 20);
      add("steam.exe", 11, 25, 12, 40);
      return { day, segments };
    }
    add("code.exe", 9, jitter, 9, jitter + 1);
    add("windowsterminal.exe", 9, jitter + 1, 9, jitter + 4);
    add("chrome.exe", 9, jitter + 4, 10, 30);
    add("notion.exe", 10, 30, 11, 0);
    if (weekday === 2 || weekday === 4 || weekday === 1) add("ms-teams.exe", 11, 0, 11, 35);
    add("chrome.exe", 11, 40, 12, 30);
    add("code.exe", 14, 0, 14, 1);
    add("windowsterminal.exe", 14, 1, 14, 20);
    add("code.exe", 14, 20, 17, 0);
    add("spotify.exe", 17, 0, 17, 5);
    add("chrome.exe", 17, 5, 18, 20 + jitter);
    if (index % 3 !== 0) add("chrome.exe", 22, 50, 23, 40);
    return { day, segments };
  });
}
