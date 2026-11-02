import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Check, Copy, Image as ImageIcon, Languages, Lightbulb, ListTree, ScanText, Sheet, X } from "lucide-react";
import { useLocale, useTranslation } from "../i18n";
import { aiErrorText } from "../assistant/aiErrors";
import "./Lens.css";

type Box = { x: number; y: number; width: number; height: number };
type Task = "translate" | "explain" | "summarize";

const MIN_SIZE = 8;

function boxOf(start: { x: number; y: number }, end: { x: number; y: number }): Box {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/** Full-screen overlay: drag around anything on screen and Nimbo reads it, offline. */
export default function LensWindow() {
  const t = useTranslation();
  const copy = t.lens;
  const { locale } = useLocale();
  const imageRef = useRef<HTMLImageElement>(null);
  const [background, setBackground] = useState<string | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [reading, setReading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ task: Task; text: string } | null>(null);
  const [busy, setBusy] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [pixels, setPixels] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const close = () => {
    if (isTauri()) void invoke("lens_close");
  };

  useEffect(() => {
    document.documentElement.classList.add("lens-root");
    if (isTauri()) void invoke<string>("lens_background").then((data) => setBackground(`data:image/png;base64,${data}`)).catch(close);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const read = (area: Box) => {
    const image = imageRef.current;
    if (!image || !isTauri()) return;
    // The picture is shown at window size; the OCR wants real screen pixels.
    const scaleX = image.naturalWidth / image.clientWidth;
    const scaleY = image.naturalHeight / image.clientHeight;
    setReading(true);
    setText(null);
    setAnswer(null);
    setError("");
    const rect = {
      x: Math.round(area.x * scaleX),
      y: Math.round(area.y * scaleY),
      width: Math.max(1, Math.round(area.width * scaleX)),
      height: Math.max(1, Math.round(area.height * scaleY)),
    };
    setPixels(rect);
    setTable(null);
    void invoke<{ text: string; table: string | null }>("lens_read", rect)
      .then((result) => {
        setText(result.text.trim());
        setTable(result.table);
      })
      .catch((failure) => setError(String(failure)))
      .finally(() => setReading(false));
  };

  const readAll = () => {
    const whole = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    setBox(whole);
    read(whole);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !box && background) readAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    setStart(point);
    setBox({ ...point, width: 0, height: 0 });
    setText(null);
    setAnswer(null);
    setError("");
  };
  const onMove = (event: ReactPointerEvent) => {
    if (start) setBox(boxOf(start, { x: event.clientX, y: event.clientY }));
  };
  const onUp = (event: ReactPointerEvent) => {
    if (!start) return;
    const area = boxOf(start, { x: event.clientX, y: event.clientY });
    setStart(null);
    if (area.width < MIN_SIZE || area.height < MIN_SIZE) {
      setBox(null);
      return;
    }
    setBox(area);
    read(area);
  };

  const flash = (what: string) => {
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1400);
  };
  const copyText = (value: string, what = "text") => {
    void invoke("copy_translation_result", { text: value }).then(() => flash(what));
  };
  const copyImage = () => {
    if (pixels) void invoke("lens_copy_image", pixels).then(() => flash("image")).catch((failure) => setError(String(failure)));
  };

  const run = (task: Task) => {
    if (!text) return;
    setBusy(task);
    setError("");
    const target = locale === "en" ? "en" : locale === "zh-CN" ? "zh" : "pt";
    const request =
      task === "translate"
        ? invoke<string>("translate_text", { text, target, alternate: target === "en" ? "pt" : "en" })
        : invoke<string>("lens_ask", { text, task, language: locale });
    void request
      // Some AIs still answer in Markdown; the card shows plain text.
      .then((result) => setAnswer({ task, text: result.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "") }))
      .catch((failure) => setError(aiErrorText(t, String(failure))))
      .finally(() => setBusy(null));
  };

  // The card sits beside the selection, or below it when there is no room.
  const card = (() => {
    if (!box) return null;
    const width = 380;
    const right = box.x + box.width + 16;
    const left = right + width < window.innerWidth ? right : Math.max(16, box.x - width - 16);
    const top = Math.min(Math.max(16, box.y), window.innerHeight - 360);
    return box.width > window.innerWidth - 2 * width ? { left: window.innerWidth / 2 - width / 2, top: 80 } : { left, top };
  })();

  return (
    <div className="lens" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      {background && <img ref={imageRef} className="lens__shot" src={background} alt="" draggable={false} />}
      <div className={`lens__shade${box ? " lens__shade--cut" : ""}`} style={box ? { clipPath: cutOut(box) } : undefined} />
      {box && <div className="lens__box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />}

      {!box && (
        <div className="lens__hint" onPointerDown={(event) => event.stopPropagation()}>
          <ScanText size={15} strokeWidth={2.4} aria-hidden="true" />
          <span>{copy.hint}</span>
          <button type="button" onClick={readAll}>
            {copy.readAll}
          </button>
          <button type="button" aria-label={copy.close} title={copy.close} onClick={close}>
            <X size={14} strokeWidth={2.6} />
          </button>
        </div>
      )}

      {box && !start && card && (
        <section className="lens__card" style={card} onPointerDown={(event) => event.stopPropagation()} aria-live="polite">
          <header>
            <ScanText size={14} strokeWidth={2.4} aria-hidden="true" />
            <strong>{copy.title}</strong>
            <button type="button" aria-label={copy.close} title={copy.close} onClick={close}>
              <X size={14} strokeWidth={2.6} />
            </button>
          </header>
          {reading && <p className="lens__status">{copy.reading}</p>}
          {!reading && text === "" && (
            <>
              <p className="lens__status">{copy.empty}</p>
              <div className="lens__actions">
                <button type="button" className="lens__primary" onClick={copyImage}>
                  {copied === "image" ? <Check size={14} strokeWidth={2.6} /> : <ImageIcon size={14} strokeWidth={2.4} />}
                  {copied === "image" ? copy.copied : copy.copyImage}
                </button>
              </div>
            </>
          )}
          {!reading && text && (
            <>
              <textarea className="lens__text" value={text} spellCheck={false} onChange={(event) => setText(event.currentTarget.value)} />
              <div className="lens__actions">
                <button type="button" className="lens__primary" onClick={() => copyText(text)}>
                  {copied === "text" ? <Check size={14} strokeWidth={2.6} /> : <Copy size={14} strokeWidth={2.4} />}
                  {copied === "text" ? copy.copied : copy.copy}
                </button>
                {table ? (
                  <button type="button" onClick={() => copyText(table, "table")}>
                    {copied === "table" ? <Check size={14} strokeWidth={2.6} /> : <Sheet size={14} strokeWidth={2.4} />}
                    {copied === "table" ? copy.copied : copy.copyTable}
                  </button>
                ) : (
                  <button type="button" onClick={copyImage}>
                    {copied === "image" ? <Check size={14} strokeWidth={2.6} /> : <ImageIcon size={14} strokeWidth={2.4} />}
                    {copied === "image" ? copy.copied : copy.copyImage}
                  </button>
                )}
                <button type="button" disabled={busy !== null} onClick={() => run("translate")}>
                  <Languages size={14} strokeWidth={2.4} />
                  {busy === "translate" ? copy.working : copy.translate}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => run("explain")}>
                  <Lightbulb size={14} strokeWidth={2.4} />
                  {busy === "explain" ? copy.working : copy.explain}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => run("summarize")}>
                  <ListTree size={14} strokeWidth={2.4} />
                  {busy === "summarize" ? copy.working : copy.summarize}
                </button>
              </div>
            </>
          )}
          {answer && (
            <div className="lens__answer">
              <span>{copy.answers[answer.task]}</span>
              <p>{answer.text}</p>
              <button type="button" onClick={() => copyText(answer.text, "answer")}>
                <Copy size={13} strokeWidth={2.4} />
                {copy.copy}
              </button>
            </div>
          )}
          {error && <p className="lens__error">{error}</p>}
          <footer>{copy.again}</footer>
        </section>
      )}
    </div>
  );
}

/** Darkens everything except the selection. */
function cutOut(box: Box) {
  const { x, y, width, height } = box;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${x + width}px ${y}px, ${x + width}px ${y + height}px, ${x}px ${y + height}px, ${x}px ${y}px)`;
}
