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

export function fitsInView(body: { x: number; y: number }, view: View) {
  return (
    body.x - VIEW_MARGIN >= view.x - 1 &&
    body.x + BUDDY_SIZE + VIEW_MARGIN <= view.x + view.width + 1 &&
    body.y - BUBBLE_LIFT - 10 >= view.y - 1 &&
    body.y + BUDDY_SIZE + 10 <= view.y + view.height + 1
  );
}
