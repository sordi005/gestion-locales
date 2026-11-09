"use client";

import * as React from "react";

import type { Scan, ScanIssue } from "@/shared/lib/scanner/scan-result";
import { Scanner } from "@/shared/ui/scanner";

type CameraMode = "continuous" | "single";

type Entry = { readonly id: number; readonly text: string };

/** "camera 7790001000019 x3 [warning]": compacto para aserciones con `toHaveText`. */
function describeScan(scan: Scan): string {
  const parts: string[] = [scan.source, scan.norm];
  if (scan.multiplier !== null) parts.push(`x${scan.multiplier}`);
  if (scan.warnings.length > 0) parts.push(`[${scan.warnings.join(",")}]`);
  return parts.join(" ");
}

/** "rejected manual 12ab invalid_chars" / "retry hid 7790001000018". */
function describeIssue(issue: ScanIssue): string {
  return issue.kind === "rejected"
    ? `rejected ${issue.source} ${issue.raw} ${issue.reason}`
    : `retry ${issue.source} ${issue.raw}`;
}

const subscribeNothing = () => () => {};

/**
 * Cuerpo de la página de prueba (`/e2e/escaner`): el escáner con sus tres
 * partes, la cámara a pedido, un botón que cuenta clics (el `Enter` del lector
 * no debe activarlo) y la lista de todo lo que entrega el componente.
 */
export function ScannerHarness() {
  const [entries, setEntries] = React.useState<readonly Entry[]>([]);
  const [showCamera, setShowCamera] = React.useState(false);
  const [mode, setMode] = React.useState<CameraMode>("continuous");
  const [clicks, setClicks] = React.useState(0);
  const nextId = React.useRef(0);
  // `false` en el servidor y hasta hidratar, `true` después: los E2E esperan
  // `data-ready` para no teclear antes de que el escáner escuche.
  const ready = React.useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );

  function addEntry(text: string) {
    const id = nextId.current++;
    setEntries((current) => [...current, { id, text }]);
  }

  return (
    <main id="contenido" data-ready={ready} className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Prueba del escáner</h1>
      <Scanner.Root
        className="flex flex-col gap-3"
        sound={false}
        onScan={(scan) => addEntry(describeScan(scan))}
        onIssue={(issue) => addEntry(describeIssue(issue))}
      >
        <Scanner.Input />
        <Scanner.Status />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showCamera}
            onChange={(event) => setShowCamera(event.target.checked)}
          />
          Mostrar cámara
        </label>
        {showCamera ? (
          <>
            <fieldset className="flex gap-4">
              <legend className="text-sm text-muted-foreground">
                Modo de la cámara
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="camera-mode"
                  checked={mode === "continuous"}
                  onChange={() => setMode("continuous")}
                />
                Continuo
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="camera-mode"
                  checked={mode === "single"}
                  onChange={() => setMode("single")}
                />
                Un disparo
              </label>
            </fieldset>
            <Scanner.Camera mode={mode} />
          </>
        ) : null}
        <button
          type="button"
          className="h-10 rounded-lg border border-input px-3"
          onClick={() => setClicks((count) => count + 1)}
        >
          Botón de prueba
        </button>
      </Scanner.Root>
      <p>
        Clics del botón: <span data-testid="clicks">{clicks}</span>
      </p>
      <ol aria-label="Lecturas" className="flex flex-col gap-1 font-mono">
        {entries.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ol>
    </main>
  );
}
