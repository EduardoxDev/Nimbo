import type { MascotFrame, MascotMood } from "./engine";

export type NodeTag = "g" | "path" | "circle" | "ellipse" | "text";
export type MascotNode = { key: string; tag: NodeTag; attrs: Record<string, string | number>; children?: MascotNode[]; text?: string };

export const INK = "#1c1b29";

type Paint = { color: string; light: string; shade: string; accent: string; ids: { body: string; bulb: string; glow: string; clip: string } };

function eyeNode(eye: MascotFrame["eyes"][number], detail: boolean, key: string): MascotNode {
  if (eye.style === "spiral") {
    return { key, tag: "circle", attrs: { cx: eye.cx, cy: eye.cy, r: 4.6, fill: "none", stroke: INK, strokeWidth: 2.4, strokeDasharray: "20 6", strokeLinecap: "round" } };
  }
  if (eye.style === "happy") {
    return {
      key,
      tag: "path",
      attrs: { d: `M${eye.cx - 5} ${eye.cy + 2} Q${eye.cx} ${eye.cy - 5.5} ${eye.cx + 5} ${eye.cy + 2}`, fill: "none", stroke: INK, strokeWidth: 3.4, strokeLinecap: "round" },
    };
  }
  if (eye.style === "closed") {
    return {
      key,
      tag: "path",
      attrs: { d: `M${eye.cx - 5} ${eye.cy} Q${eye.cx} ${eye.cy + 3.5} ${eye.cx + 5} ${eye.cy}`, fill: "none", stroke: INK, strokeWidth: 3, strokeLinecap: "round" },
    };
  }
  const ry = Math.max(0.8, eye.ry);
  const children: MascotNode[] = [{ key: `${key}-ball`, tag: "ellipse", attrs: { cx: eye.cx, cy: eye.cy, rx: eye.rx, ry, fill: INK } }];
  if (detail && ry > 3) {
    children.push(
      { key: `${key}-shine`, tag: "circle", attrs: { cx: eye.cx + 1.4, cy: eye.cy - ry * 0.42, r: 1.9, fill: "#fff" } },
      { key: `${key}-glint`, tag: "circle", attrs: { cx: eye.cx - 1.5, cy: eye.cy + ry * 0.38, r: 0.9, fill: "#fff", fillOpacity: 0.75 } },
    );
  }
  return { key, tag: "g", attrs: {}, children };
}

function mouthNode(mouth: MascotFrame["mouth"]): MascotNode {
  const { cx, cy } = mouth;
  const key = `mouth-${mouth.style}`;
  const stroke = { fill: "none", stroke: INK, strokeWidth: 2.4, strokeLinecap: "round" };
  switch (mouth.style) {
    case "smile":
      return { key, tag: "path", attrs: { d: `M${cx - 4} ${cy - 1} Q${cx} ${cy + 3} ${cx + 4} ${cy - 1}`, ...stroke } };
    case "grin":
      return {
        key,
        tag: "g",
        attrs: {},
        children: [
          { key: `${key}-lips`, tag: "path", attrs: { d: `M${cx - 6} ${cy - 2} Q${cx} ${cy + 7} ${cx + 6} ${cy - 2} Z`, fill: INK, stroke: INK, strokeWidth: 1.6, strokeLinejoin: "round" } },
          { key: `${key}-tongue`, tag: "path", attrs: { d: `M${cx - 2.6} ${cy + 2.4} Q${cx} ${cy + 0.6} ${cx + 2.6} ${cy + 2.4}`, fill: "#ff7a9a" } },
        ],
      };
    case "o":
      return { key, tag: "ellipse", attrs: { cx, cy: cy + 1, rx: 2.4, ry: 3, fill: INK } };
    case "flat":
      return { key, tag: "path", attrs: { d: `M${cx - 3.5} ${cy} L${cx + 3.5} ${cy}`, ...stroke } };
    case "hmm":
      return { key, tag: "path", attrs: { d: `M${cx - 2} ${cy + 0.5} Q${cx + 2} ${cy - 1.5} ${cx + 5} ${cy}`, ...stroke } };
    case "wavy":
      return { key, tag: "path", attrs: { d: `M${cx - 6} ${cy} q1.5 -2.5 3 0 t3 0 t3 0 t3 0`, ...stroke, strokeWidth: 2 } };
  }
}

export function wingPath(side: "left" | "right", t: number) {
  const flap = Math.sin(t * 9);
  return side === "left"
    ? `M22 50 Q${2 - flap * 6} ${34 - flap * 8} ${6 - flap * 4} 58 Q14 60 22 58 Z`
    : `M78 50 Q${98 + flap * 6} ${34 - flap * 8} ${94 + flap * 4} 58 Q86 60 78 58 Z`;
}

export function bodyTransform(frame: MascotFrame) {
  return `translate(0 ${frame.offsetY}) rotate(${frame.rotation} 50 50) translate(50 84) scale(${frame.scale * frame.squash.x} ${frame.scale * frame.squash.y}) translate(-50 -84)`;
}

export function mascotNodes(
  frame: MascotFrame,
  options: { detail: boolean; paint: Paint; aura: "sparkle" | "wings" | null; glow: boolean; showDot: boolean; mood: MascotMood; time: number },
) {
  const { detail, paint, aura, glow, showDot, mood, time } = options;
  const before: MascotNode[] = [];
  if (aura === "wings") {
    before.push({
      key: "wings",
      tag: "g",
      attrs: { className: "mascot__wings", transform: `translate(0 ${frame.offsetY})`, fill: "#ffffff", fillOpacity: 0.85 },
      children: [
        { key: "wing-left", tag: "path", attrs: { d: wingPath("left", time) } },
        { key: "wing-right", tag: "path", attrs: { d: wingPath("right", time) } },
      ],
    });
  }
  if (aura) {
    before.push({
      key: "sparkles",
      tag: "g",
      attrs: { className: "mascot__sparkles", fill: "#ffd60a" },
      children: [
        { key: "sparkle-1", tag: "path", attrs: { d: "M12 18 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" } },
        { key: "sparkle-2", tag: "path", attrs: { d: "M86 70 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 Z" } },
        { key: "sparkle-3", tag: "path", attrs: { d: "M90 14 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 l3 -1 Z" } },
      ],
    });
  }
  if (glow) before.push({ key: "glow", tag: "circle", attrs: { className: "mascot__glow", cx: 50, cy: 52, r: 58, fill: `url(#${paint.ids.glow})` } });
  if (detail) {
    before.push({
      key: "shadow",
      tag: "ellipse",
      attrs: { className: "mascot__shadow", cx: 50, cy: 91, rx: 24 + frame.offsetY * 1.2, ry: 3.2, fill: "#000", fillOpacity: Math.max(0.08, 0.28 + frame.offsetY * 0.03) },
    });
  }

  const body: MascotNode[] = [];
  if (detail && frame.antenna) {
    const [tipX, tipY] = frame.antenna.tip;
    const antenna: MascotNode[] = [
      { key: "antenna-stem", tag: "path", attrs: { d: `M50 24 Q${(50 + tipX) / 2 - 3} ${tipY + 10} ${tipX} ${tipY + 4}`, fill: "none", stroke: paint.shade, strokeWidth: 2.4, strokeLinecap: "round" } },
    ];
    if (frame.antenna.on) antenna.push({ key: "antenna-bulb", tag: "circle", attrs: { cx: tipX, cy: tipY, r: 9, fill: `url(#${paint.ids.bulb})` } });
    antenna.push(
      { key: "antenna-tip", tag: "circle", attrs: { cx: tipX, cy: tipY, r: 3.6, fill: frame.antenna.on ? paint.accent : paint.shade } },
      { key: "antenna-shine", tag: "circle", attrs: { cx: tipX - 1, cy: tipY - 1.2, r: 1.1, fill: "#fff", fillOpacity: 0.85 } },
    );
    body.push({ key: "antenna", tag: "g", attrs: { className: "mascot__antenna" }, children: antenna });
  }
  if (detail) {
    frame.arms.forEach((arm, index) => {
      const d = `M${arm.shoulder[0]} ${arm.shoulder[1]} L${arm.hand[0]} ${arm.hand[1]}`;
      body.push({
        key: `arm-${index}`,
        tag: "g",
        attrs: { className: "mascot__arm" },
        children: [
          { key: `arm-${index}-edge`, tag: "path", attrs: { d, stroke: paint.shade, strokeWidth: 9.5, strokeLinecap: "round" } },
          { key: `arm-${index}-fill`, tag: "path", attrs: { d, stroke: paint.color, strokeWidth: 7, strokeLinecap: "round" } },
        ],
      });
    });
  }
  body.push({ key: "body", tag: "path", attrs: { className: "mascot__body", d: frame.body, fill: `url(#${paint.ids.body})` } });
  body.push({
    key: "body-light",
    tag: "g",
    attrs: { clipPath: `url(#${paint.ids.clip})` },
    children: [
      { key: "body-rim", tag: "path", attrs: { d: frame.body, fill: "none", stroke: paint.shade, strokeOpacity: 0.35, strokeWidth: 5 } },
      { key: "body-gloss", tag: "ellipse", attrs: { cx: 36, cy: 27, rx: 13, ry: 6, fill: "#fff", fillOpacity: 0.6, transform: "rotate(-22 36 27)" } },
      { key: "body-spark", tag: "circle", attrs: { cx: 53, cy: 22, r: 2.2, fill: "#fff", fillOpacity: 0.55 } },
    ],
  });
  if (detail) {
    frame.cheeks.forEach((cheek, index) => {
      body.push({ key: `cheek-${index}`, tag: "ellipse", attrs: { cx: cheek.cx, cy: cheek.cy, rx: 5, ry: 3, fill: "#ff7a9a", fillOpacity: 0.38 } });
    });
  }
  frame.eyes.forEach((eye, index) => body.push(eyeNode(eye, detail, `eye-${index}-${eye.style}`)));
  if (detail) body.push(mouthNode(frame.mouth));

  const after: MascotNode[] = [];
  if (showDot && frame.dot && !(detail && frame.antenna)) {
    after.push({ key: "dot", tag: "circle", attrs: { className: "mascot__dot", cx: 20, cy: 20, r: 8, fill: frame.dot, stroke: "#0b0b0f", strokeWidth: 3.5 } });
  }
  if (mood === "sleeping") {
    after.push({ key: "z", tag: "text", attrs: { className: "mascot__z", x: 76, y: 24, fontSize: 18, fontWeight: 700, fill: paint.light }, text: "z" });
  }

  return { before, body, after, clip: frame.body, transform: bodyTransform(frame) };
}

export function shapeOf(nodes: MascotNode[]): string {
  return nodes.map((node) => `${node.tag}:${node.key}${node.children ? `(${shapeOf(node.children)})` : ""}`).join(",");
}

export function flatten(nodes: MascotNode[], into: MascotNode[] = []) {
  for (const node of nodes) {
    into.push(node);
    if (node.children) flatten(node.children, into);
  }
  return into;
}

export function domName(attribute: string) {
  if (attribute === "className") return "class";
  return attribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
