import { BUDDY_SIZE } from "./physics";

const BUBBLE_LIFT = 62;
export const VIEW_WIDTH = 460;
const VIEW_HEIGHT = 300;
const VIEW_MARGIN = 70;

export type View = { x: number; y: number; width: number; height: number };

export function viewAround(body: { x: number; y: number }, screen: { width: number; height: number }): View {
  const width = Math.min(VIEW_WIDTH, screen.width);
  const height = Math.min(VIEW_HEIGHT, screen.height);
  return {
    x: Math.round(Math.min(Math.max(body.x + BUDDY_SIZE / 2 - width / 2, 0), screen.width - width)),
    y: Math.round(Math.min(Math.max(body.y + BUDDY_SIZE - height * 0.72, 0), screen.height - height)),
    width,
    height,
  };
}

export function fitsInView(body: { x: number; y: number }, view: View, screen: { width: number; height: number }) {
  const left = Math.max(0, body.x - VIEW_MARGIN);
  const right = Math.min(screen.width, body.x + BUDDY_SIZE + VIEW_MARGIN);
  const top = Math.max(0, body.y - BUBBLE_LIFT - 10);
  const bottom = Math.min(screen.height, body.y + BUDDY_SIZE + 10);
  return left >= view.x - 1 && right <= view.x + view.width + 1 && top >= view.y - 1 && bottom <= view.y + view.height + 1;
}
