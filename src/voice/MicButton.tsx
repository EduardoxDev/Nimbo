import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { useLocale, useTranslation } from "../i18n";
import { cancelListening, listenOnce, stopSpeaking } from "./voice";
import "./Voice.css";

export function MicButton({
  onText,
  onError,
  disabled = false,
  startToken = 0,
  className = "",
}: {
  onText: (text: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  startToken?: number;
  className?: string;
}) {
  const copy = useTranslation().voice;
  const { locale } = useLocale();
  const [listening, setListening] = useState(false);
  const handlersRef = useRef({ onText, onError });
  handlersRef.current = { onText, onError };
  const listeningRef = useRef(false);

  const start = () => {
    if (listeningRef.current) {
      cancelListening();
      return;
    }
    stopSpeaking();
    listeningRef.current = true;
    setListening(true);
    void listenOnce(locale)
      .then((text) => {
        if (text) handlersRef.current.onText(text);
        else handlersRef.current.onError(copy.nothingHeard);
      })
      .catch((failure) => handlersRef.current.onError(String(failure)))
      .finally(() => {
        listeningRef.current = false;
        setListening(false);
      });
  };

  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (startToken > 0 && !listeningRef.current) startRef.current();
  }, [startToken]);

  useEffect(() => () => {
    if (listeningRef.current) cancelListening();
  }, []);

  return (
    <button
      className={`mic-button${listening ? " mic-button--listening" : ""} ${className}`.trim()}
      type="button"
      title={listening ? copy.stop : copy.start}
      aria-label={listening ? copy.stop : copy.start}
      aria-pressed={listening}
      disabled={disabled && !listening}
      onClick={start}
    >
      {listening ? <MicOff size={14} strokeWidth={2.4} /> : <Mic size={14} strokeWidth={2.4} />}
    </button>
  );
}
