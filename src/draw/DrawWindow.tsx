import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Check, Undo2, X } from "lucide-react";
import { useTranslation } from "../i18n";
import "./Draw.css";

type Stroke = { color: string; size: number; points: { x: number; y: number }[] };

const COLORS = ["#ff453a", "#ffd60a", "#35e985", "#5ac8fa", "#ffffff"];
const SIZES = [3, 6, 12];

function paint(context: CanvasRenderingContext2D, strokes: Stroke[], scale: number) {
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.size * scale;
    context.beginPath();
    context.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * scale, point.y * scale);
    if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * scale + 0.1, stroke.points[0].y * scale);
    context.stroke();
  }
}

export default function DrawWindow() {
  const copy = useTranslation().draw;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [background, setBackground] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const drawingRef = useRef<Stroke | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("draw-root");
    if (isTauri()) void invoke<string>("draw_background").then((data) => setBackground(`data:image/png;base64,${data}`)).catch(() => close());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    paint(context, drawingRef.current ? [...strokes, drawingRef.current] : strokes, ratio);
  });

  const close = () => {
    if (isTauri()) void invoke("draw_finish", { png: null });
  };

  const copyResult = () => {
    if (!background) return;
    const image = new Image();
    image.onload = () => {
      const output = document.createElement("canvas");
      output.width = image.naturalWidth;
      output.height = image.naturalHeight;
      const context = output.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0);
      paint(context, strokes, image.naturalWidth / window.innerWidth);
      if (isTauri()) void invoke("draw_finish", { png: output.toDataURL("image/png") });
    };
    image.src = background;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "Enter" || (event.ctrlKey && event.key.toLowerCase() === "c")) copyResult();
      else if (event.ctrlKey && event.key.toLowerCase() === "z") setStrokes((current) => current.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="draw" style={background ? { backgroundImage: `url(${background})` } : undefined}>
      <canvas
        ref={canvasRef}
        className="draw__canvas"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawingRef.current = { color, size, points: [{ x: event.clientX, y: event.clientY }] };
          setStrokes((current) => [...current]);
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          drawingRef.current.points.push({ x: event.clientX, y: event.clientY });
          setStrokes((current) => [...current]);
        }}
        onPointerUp={() => {
          const stroke = drawingRef.current;
          drawingRef.current = null;
          if (stroke) setStrokes((current) => [...current, stroke]);
        }}
      />
      <div className="draw__toolbar" role="toolbar" aria-label={copy.title}>
        {COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`draw__swatch${swatch === color ? " draw__swatch--active" : ""}`}
            style={{ background: swatch }}
            aria-label={swatch}
            aria-pressed={swatch === color}
            onClick={() => setColor(swatch)}
          />
        ))}
        <span className="draw__divider" />
        {SIZES.map((value) => (
          <button
            key={value}
            type="button"
            className={`draw__size${value === size ? " draw__size--active" : ""}`}
            aria-label={`${value}px`}
            aria-pressed={value === size}
            onClick={() => setSize(value)}
          >
            <i style={{ width: value + 2, height: value + 2 }} />
          </button>
        ))}
        <span className="draw__divider" />
        <button type="button" className="draw__action" title={copy.undo} aria-label={copy.undo} onClick={() => setStrokes((current) => current.slice(0, -1))}>
          <Undo2 size={15} strokeWidth={2.4} />
        </button>
        <button type="button" className="draw__action draw__action--primary" onClick={copyResult}>
          <Check size={15} strokeWidth={2.6} />
          {copy.copy}
        </button>
        <button type="button" className="draw__action" title={copy.close} aria-label={copy.close} onClick={close}>
          <X size={15} strokeWidth={2.6} />
        </button>
      </div>
      <span className="draw__hint">{copy.hint}</span>
    </div>
  );
}
