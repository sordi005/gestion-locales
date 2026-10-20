"use client";

import { UserRoundIcon } from "lucide-react";
import Link from "next/link";

import { LogoutButton } from "@/features/auth/components";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";

import { LOCATIONS_PATH } from "../domain/navigation";
import { BOTTOM_BAR_ITEM_CLASS } from "./shell-nav";

type AccountSheetProps = {
  userName: string;
  locationName: string;
  organizationName: string;
  canSwitchLocation: boolean;
};

/**
 * "Cuenta" de la barra inferior del celular: un panel con la persona, el local y
 * la organización, "Cambiar de local" (solo con más de un local) y "Cerrar
 * sesión". Lleva título (`SheetTitle`) para los lectores de pantalla.
 */
export function AccountSheet({
  userName,
  locationName,
  organizationName,
  canSwitchLocation,
}: AccountSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" className={BOTTOM_BAR_ITEM_CLASS}>
          <UserRoundIcon aria-hidden="true" />
          <span>Cuenta</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-6 overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="p-0 pr-10">
          <SheetTitle>Cuenta</SheetTitle>
          <SheetDescription>Sesión iniciada como {userName}</SheetDescription>
        </SheetHeader>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex flex-col">
            <dt className="text-muted-foreground">Local</dt>
            <dd className="font-medium">{locationName}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-muted-foreground">Organización</dt>
            <dd className="font-medium">{organizationName}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-3 [&>a]:h-11 [&>button]:h-11">
          {canSwitchLocation ? (
            <Button asChild variant="outline">
              <Link href={LOCATIONS_PATH}>Cambiar de local</Link>
            </Button>
          ) : null}
          <LogoutButton />
          {/* La "X" de shadcn mide 28 px: acá un botón de texto de 44 px. */}
          <SheetClose asChild>
            <Button variant="ghost" className="h-11">
              Cerrar
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
