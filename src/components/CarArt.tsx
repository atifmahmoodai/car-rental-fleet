import { useId } from "react";
type BodyType = "Sedan" | "SUV" | "Hatchback" | "Pickup" | "Coupe" | "Van";

// Side-profile silhouettes on a 320x140 canvas. Wheels sit at x=80 and x=240.
const WHEEL_ARCHES = "L262,110 A22,22 0 0 0 218,110 L102,110 A22,22 0 0 0 58,110";

// Every silhouette faces left; `rear` is the x of the back bumper for the tail light.
const SHAPES: Record<BodyType, { body: string; windows: string[]; rear: number }> = {
  Sedan: {
    body: `M20,100 Q20,82 40,80 L95,74 Q120,50 150,46 L205,46 Q230,48 250,72 L290,78 Q305,82 305,98 L305,104 Q305,110 298,110 ${WHEEL_ARCHES} L28,110 Q20,110 20,104 Z`,
    windows: ["M106,74 Q126,55 150,52 L174,52 L174,74 Z", "M181,52 L203,52 Q222,54 238,74 L181,74 Z"], rear: 305,
  },
  SUV: {
    body: `M18,98 Q18,70 36,68 L70,64 Q88,36 110,34 L240,34 Q258,34 268,62 L292,68 Q306,72 306,92 L306,104 Q306,110 299,110 ${WHEEL_ARCHES} L26,110 Q18,110 18,104 Z`,
    windows: ["M82,64 Q95,43 112,41 L160,41 L160,64 Z", "M167,41 L214,41 L214,64 L167,64 Z", "M221,41 L238,41 Q250,42 258,64 L221,64 Z"], rear: 306,
  },
  Hatchback: {
    body: `M24,100 Q24,82 44,79 L96,72 Q120,48 150,45 L240,44 Q262,46 272,64 L288,80 Q296,86 296,100 L296,104 Q296,110 289,110 ${WHEEL_ARCHES} L32,110 Q24,110 24,104 Z`,
    windows: ["M107,72 Q128,52 152,51 L186,51 L186,72 Z", "M193,51 L238,51 Q254,52 263,72 L193,72 Z"], rear: 296,
  },
  Pickup: {
    body: `M16,100 Q16,78 34,76 L78,72 Q92,40 112,38 L170,38 Q180,38 182,50 L184,72 L300,72 Q306,72 306,80 L306,104 Q306,110 300,110 ${WHEEL_ARCHES} L24,110 Q16,110 16,104 Z`,
    windows: ["M89,70 Q99,46 115,45 L135,45 L135,70 Z", "M141,45 L168,45 Q174,45 175,52 L176,70 L141,70 Z"], rear: 306,
  },
  Coupe: {
    body: `M18,100 Q18,86 36,83 L100,76 Q132,52 165,50 L200,50 Q228,52 256,74 L294,80 Q306,84 306,98 L306,104 Q306,110 299,110 ${WHEEL_ARCHES} L26,110 Q18,110 18,104 Z`,
    windows: ["M114,76 Q139,58 165,56 L185,56 L185,76 Z", "M191,56 L200,56 Q220,58 239,76 L191,76 Z"], rear: 306,
  },
  Van: {
    body: `M16,100 Q16,62 30,52 L60,32 Q66,28 76,28 L292,28 Q304,28 304,40 L304,104 Q304,110 298,110 ${WHEEL_ARCHES} L24,110 Q16,110 16,104 Z`,
    windows: ["M40,62 L66,36 L110,36 L110,62 Z", "M116,36 L170,36 L170,62 L116,62 Z", "M176,36 L230,36 L230,62 L176,62 Z"], rear: 304,
  },
};

function isLight(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

interface Props {
  bodyType: BodyType;
  colorHex: string;
  title?: string;
  className?: string;
}

/** Illustrated stand-in for a vehicle photo, tinted in the car's paint colour. */
export function CarArt({ bodyType, colorHex, title, className }: Props) {
  const shape = SHAPES[bodyType] ?? SHAPES.Sedan;
  const outline = isLight(colorHex) ? "#94a3b8" : "rgba(0,0,0,0.35)";
  const shineId = `shine-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 320 140" className={className} role="img" aria-label={title ?? `${bodyType} illustration`}>
      <ellipse cx="162" cy="128" rx="140" ry="7" fill="rgba(0,0,0,0.18)" />
      <path d={shape.body} fill={colorHex} stroke={outline} strokeWidth="1.5" strokeLinejoin="round" />
      {shape.windows.map((d) => (
        <path key={d} d={d} fill="#1e293b" opacity="0.85" />
      ))}
      <path d={shape.body} fill={`url(#${shineId})`} opacity="0.35" />
      <defs>
        <linearGradient id={shineId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="19" y="86" width="9" height="5" rx="2" fill="#fde68a" />
      <rect x={shape.rear - 7} y="82" width="5" height="8" rx="2" fill="#ef4444" />
      {[80, 240].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="110" r="19" fill="#1f2937" />
          <circle cx={cx} cy="110" r="10" fill="#cbd5e1" />
          <circle cx={cx} cy="110" r="3" fill="#475569" />
        </g>
      ))}
    </svg>
  );
}
