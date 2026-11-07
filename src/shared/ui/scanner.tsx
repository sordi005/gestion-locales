"use client";

import * as React from "react";
import { cn } from "cn";

import { createScanFeedback } from "@/shared/lib/scanner/feedback";
import { subscribeHidCapture } from "@/shared/lib/scanner/hid-capture";
import { splitMultiplier } from "@/shared/lib/scanner/multiplier";
import {
  scanAcceptedMessage,
  scanIssueMessage,
} from "@/shared/lib/scanner/scan-messages";
import {
  EMPTY_SCAN_MEMORY,
  toScanOutcome,
} from "@/shared/lib/scanner/scan-result";
import type {
  Scan,
  ScanIssue,
  ScanMemory,
  ScanOutcome,
  ScanSource,
} from "@/shared/lib/scanner/scan-result";
import { ScannerCamera } from "@/shared/ui/scanner-camera";
import { ScannerContext, useScannerContext } from "@/shared/ui/scanner-context";
import type {
  ScannerContextValue,
  ScannerStatus,
} from "@/shared/ui/scanner-context";

const IDLE_STATUS: ScannerStatus = { kind: "idle", message: "", seq: 0 };

/** Feedback con el `AudioContext` y la vibración del navegador, si existen. */
function createBrowserFeedback(sound: boolean) {
  return createScanFeedback({
    sound,
    audioContextFactory: () =>
      typeof AudioContext === "undefined" ? null : new AudioContext(),
    vibrate: (pattern) =>
      typeof navigator !== "undefined" && "vibrate" in navigator
        ? navigator.vibrate(pattern)
        : false,
  });
}

type ScannerRootProps = Omit<React.ComponentProps<"div">, "onScan"> & {
  readonly onScan: (scan: Scan) => void;
  readonly onIssue?: (issue: ScanIssue) => void;
  readonly enabled?: boolean;
  /** Pitidos de cada resultado; `false` no crea nunca el `AudioContext`. */
  readonly sound?: boolean;
};

/**
 * Gestos que el navegador acepta para reanudar el audio. iOS Safari no cuenta
 * `pointerdown`/`touchstart`: pide que el dedo se levante (o un clic o tecla).
 */
const UNLOCK_EVENTS = ["pointerup", "click", "touchend", "keydown"] as const;

function Root({
  ref,
  onScan,
  onIssue,
  enabled = true,
  sound = true,
  className,
  children,
  ...props
}: ScannerRootProps) {
  const [status, setStatus] = React.useState<ScannerStatus>(IDLE_STATUS);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const memoryRef = React.useRef<ScanMemory>(EMPTY_SCAN_MEMORY);
  const seqRef = React.useRef(0);

  // Los handlers y `enabled` se leen de una ref: cambiarlos no recrea
  // `submitRaw` ni obliga a quienes lo usan (cámara, lector) a re-suscribirse.
  const feedback = React.useMemo(() => createBrowserFeedback(sound), [sound]);
  const latest = React.useRef({ onScan, onIssue, enabled, feedback });
  React.useEffect(() => {
    latest.current = { onScan, onIssue, enabled, feedback };
  });

  // El `AudioContext` solo puede reanudarse tras un gesto: se intenta en cada
  // uno hasta que corre (en iPhone el primero puede no alcanzar). iOS lo vuelve
  // a interrumpir al salir de la pestaña: al volver a verse, si ya no corre, se
  // re-arman los gestos. Al irse (o al cambiar `sound`) se cierra, así no queda
  // un contexto por cada montaje.
  React.useEffect(() => {
    const removeAll = () => {
      for (const type of UNLOCK_EVENTS) {
        window.removeEventListener(type, unlock, true);
      }
    };
    // Agregar dos veces el mismo listener no lo duplica.
    const arm = () => {
      for (const type of UNLOCK_EVENTS) {
        window.addEventListener(type, unlock, true);
      }
    };
    const unlock = () => {
      feedback.unlock();
      if (feedback.unlocked()) removeAll();
    };
    const rearmWhenVisible = () => {
      if (document.visibilityState === "visible" && !feedback.unlocked()) {
        arm();
      }
    };
    arm();
    document.addEventListener("visibilitychange", rearmWhenVisible);
    return () => {
      removeAll();
      document.removeEventListener("visibilitychange", rearmWhenVisible);
      feedback.dispose();
    };
  }, [feedback]);

  const submitRaw = React.useCallback(
    (raw: string, source: ScanSource): ScanOutcome | null => {
      if (!latest.current.enabled && source !== "manual") return null;
      const { multiplier, rest } =
        source === "camera"
          ? { multiplier: null, rest: raw }
          : splitMultiplier(raw);
      const result = toScanOutcome(
        rest,
        source,
        multiplier,
        memoryRef.current,
        performance.now(),
      );
      memoryRef.current = result.memory;
      const { outcome } = result;
      seqRef.current += 1;
      if (outcome.kind === "scan") {
        setStatus({
          kind: "accepted",
          message: scanAcceptedMessage(outcome.scan.norm),
          seq: seqRef.current,
        });
        latest.current.feedback.play("accepted");
        latest.current.onScan(outcome.scan);
      } else {
        setStatus({
          kind: outcome.kind,
          message: scanIssueMessage(outcome),
          seq: seqRef.current,
        });
        latest.current.feedback.play(outcome.kind);
        latest.current.onIssue?.(outcome);
      }
      return outcome;
    },
    [],
  );

  // Captura global del lector USB: solo mientras esté habilitado. Deshabilitado
  // se da de baja de la pila (no la tapa), así el escáner anterior sigue
  // recibiendo. `submitRaw` es estable, por eso las deps son primitivas.
  React.useEffect(() => {
    if (!enabled) return;
    return subscribeHidCapture({
      container: () => containerRef.current,
      ownInput: () => inputRef.current,
      onRaw: (raw) => {
        const field = inputRef.current;
        const fromOwnInput = field !== null && field === document.activeElement;
        const outcome = submitRaw(raw, "hid");
        // Como al tipear: lo aceptado vacía el campo; un `retry` o un rechazo
        // lo dejan con lo que tenía antes de la ráfaga (p. ej. el `3*`).
        if (fromOwnInput && outcome?.kind === "scan") field.value = "";
      },
    });
  }, [enabled, submitRaw]);

  const focusInput = React.useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const value = React.useMemo<ScannerContextValue>(
    () => ({
      submitRaw,
      status,
      enabled,
      inputRef,
      containerRef,
      focusInput,
    }),
    [submitRaw, status, enabled, focusInput],
  );

  // `containerRef` es del escáner: el `ref` del consumidor se suma, no lo pisa.
  const setContainer = React.useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <ScannerContext.Provider value={value}>
      <div
        ref={setContainer}
        data-slot="scanner"
        className={cn("flex flex-col gap-2", className)}
        {...props}
      >
        {children}
      </div>
    </ScannerContext.Provider>
  );
}

type ScannerInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "name" | "defaultValue" | "value"
>;

function Input({ ref, className, onKeyDown, ...props }: ScannerInputProps) {
  const { submitRaw, inputRef } = useScannerContext("Scanner.Input");
  React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, [
    inputRef,
  ]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    // Un `Enter` del escáner nunca debe enviar el formulario que lo rodee.
    event.preventDefault();
    const field = event.currentTarget;
    const text = field.value.trim();
    if (text === "") return;
    const outcome = submitRaw(text, "manual");
    if (outcome?.kind === "scan") field.value = "";
  }

  return (
    <input
      ref={inputRef}
      data-slot="scanner-input"
      type="text"
      aria-label="Código de barras"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      inputMode="numeric"
      enterKeyHint="enter"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
}

function Status({ className, ...props }: React.ComponentProps<"p">) {
  const { status } = useScannerContext("Scanner.Status");
  return (
    <p
      role="status"
      aria-live="polite"
      data-slot="scanner-status"
      data-state={status.kind}
      className={cn(
        "min-h-5 text-sm text-muted-foreground data-[state=rejected]:text-destructive",
        className,
      )}
      {...props}
    >
      {/* Una `key` nueva por resultado: dos mensajes iguales seguidos igual
          cambian el DOM y el lector de pantalla los anuncia otra vez. */}
      <span key={status.seq}>{status.message}</span>
    </p>
  );
}

export const Scanner = {
  Root,
  Camera: ScannerCamera,
  Input,
  Status,
};
