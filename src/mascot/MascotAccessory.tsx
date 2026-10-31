import type { MascotAccessory } from "./accessories";
import type { MascotFrame } from "./engine";

const INK = "#16161b";

export function AccessoryShape({ accessory, eyes }: { accessory: MascotAccessory; eyes: MascotFrame["eyes"] }) {
  switch (accessory) {
    case "nightcap":
      return (
        <g className="mascot__accessory">
          <path d="M30 26 Q44 0 82 6 Q70 14 70 26 Z" fill="#6e6af0" />
          <path d="M27 28 Q50 15 73 28 L71 32 Q50 21 29 32 Z" fill="#f2f2f7" />
          <circle cx="83" cy="7" r="5.5" fill="#f2f2f7" />
        </g>
      );
    case "tophat":
      return (
        <g className="mascot__accessory">
          <rect x="37" y="-2" width="26" height="21" rx="3" fill={INK} />
          <rect x="37" y="13" width="26" height="4" fill="#ff453a" />
          <ellipse cx="50" cy="19" rx="21" ry="4.5" fill={INK} />
        </g>
      );
    case "crown":
      return (
        <g className="mascot__accessory">
          <path d="M34 20 L34 4 L42 12 L50 1 L58 12 L66 4 L66 20 Z" fill="#ffd60a" stroke="#c99a00" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="50" cy="13" r="2.4" fill="#ff453a" />
        </g>
      );
    case "headphones":
      return (
        <g className="mascot__accessory">
          <path d="M17 48 Q17 9 50 9 Q83 9 83 48" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
          <rect x="8" y="40" width="13" height="21" rx="5" fill={INK} />
          <rect x="79" y="40" width="13" height="21" rx="5" fill={INK} />
        </g>
      );
    case "sunglasses": {
      if (eyes.length < 2) return null;
      const [left, right] = eyes[0].cx < eyes[1].cx ? [eyes[0], eyes[1]] : [eyes[1], eyes[0]];
      return (
        <g className="mascot__accessory">
          <rect x={left.cx - 9} y={left.cy - 6} width="18" height="12" rx="5" fill={INK} />
          <rect x={right.cx - 9} y={right.cy - 6} width="18" height="12" rx="5" fill={INK} />
          <path d={`M${left.cx + 9} ${left.cy - 2} Q50 ${Math.min(left.cy, right.cy) - 6} ${right.cx - 9} ${right.cy - 2}`} fill="none" stroke={INK} strokeWidth="2.5" />
          <path d={`M${left.cx - 6} ${left.cy - 3} l4 -1.5`} stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      );
    }
    case "glasses": {
      if (eyes.length < 2) return null;
      const [left, right] = eyes[0].cx < eyes[1].cx ? [eyes[0], eyes[1]] : [eyes[1], eyes[0]];
      return (
        <g className="mascot__accessory" fill="none" stroke={INK} strokeWidth="2.6">
          <circle cx={left.cx} cy={left.cy} r="8" />
          <circle cx={right.cx} cy={right.cy} r="8" />
          <path d={`M${left.cx + 8} ${left.cy} Q50 ${Math.min(left.cy, right.cy) - 4} ${right.cx - 8} ${right.cy}`} />
        </g>
      );
    }
    case "beret":
      return (
        <g className="mascot__accessory">
          <path d="M26 24 Q30 6 54 7 Q78 8 76 22 Q62 28 26 24 Z" fill="#ff453a" />
          <rect x="49" y="2" width="4" height="6" rx="2" fill="#ff453a" />
        </g>
      );
    case "umbrella":
      return (
        <g className="mascot__accessory">
          <path d="M76 16 L76 46 Q76 51 71 50" fill="none" stroke="#d0d0d6" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M54 17 Q75 -6 98 17 Q92 13 87 17 Q81 13 76 17 Q70 13 65 17 Q59 13 54 17 Z" fill="#ff453a" />
        </g>
      );
  }
}
