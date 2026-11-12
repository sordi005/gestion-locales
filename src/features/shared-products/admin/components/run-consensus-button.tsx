"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

import { runSharedProductConsensus } from "../actions";

const SKIPPED_MESSAGE =
  "Ya hay una promoción corriendo. Probá de nuevo en un rato.";

function promotedMessage(count: number | null): string {
  if (count === null) return SKIPPED_MESSAGE;
  if (count === 0) return "No había códigos para promover.";
  if (count === 1) return "Se promovió 1 código a la base.";
  return `Se promovieron ${count} códigos a la base.`;
}

/**
 * Corre la promoción por consenso a mano (la que `pg_cron` corre una vez por
 * día): promueve los códigos que dos o más comercios nombraron igual. Avisa
 * cuántos entraron a la base.
 */
export function RunConsensusButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const result = await runSharedProductConsensus();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setNotice(promotedMessage(result.value));
      if (result.value !== null) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={handleClick}
      >
        Correr la promoción
      </Button>
      {notice === null ? null : (
        <p role="status" className="text-sm font-medium">
          {notice}
        </p>
      )}
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
