import Link from "next/link";
import type { ReactNode } from "react";

import { LogoutButton } from "@/features/auth/components";
import { PRODUCT_NAME } from "@/shared/lib/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/shared/ui/sidebar";

import { LOCATIONS_PATH } from "../domain/navigation";
import type { ShellModel } from "../domain/shell-model";
import { AccountSheet } from "./account-sheet";
import { BottomNav, SidebarNav } from "./shell-nav";
import { SuspendedBanner } from "./suspended-banner";

const TEXT = {
  sidebar: "Menú lateral",
  switchLocation: "Cambiar de local",
} as const;

type AppShellProps = {
  /** Lo único que el servidor le pasa al marco (ver `buildShellModel`). */
  model: ShellModel;
  children: ReactNode;
};

/**
 * Marco de las pantallas de un local (D10, D11). Es un componente de servidor:
 * solo las partes que necesitan el navegador (la sección actual, el panel de
 * "Cuenta" y el botón de cerrar sesión) son componentes cliente chicos.
 *
 * - **PC (`md` y más):** menú lateral con el producto, el local y la organización,
 *   las secciones, "Cambiar de local" (si hay más de un local) y, abajo, la
 *   persona y "Cerrar sesión".
 * - **Celular:** encabezado con el local y la persona, y barra inferior con las
 *   secciones y "Cuenta".
 *
 * Los dos se dibujan siempre y los alterna el CSS (`md:`), no el dispositivo
 * detectado: no hay diferencias de hidratación. El `<main id="contenido">` es el
 * del `SidebarInset` y lleva adentro el aviso de organización suspendida (así
 * "Saltar al contenido" no se lo salta); el menú, el encabezado y la barra quedan
 * fuera. Sin cookie
 * ni atajo de teclado propios del menú (ver `shared/ui/sidebar.tsx`).
 */
export function AppShell({ model, children }: AppShellProps) {
  const { userName, location, organization, sections } = model;

  return (
    <SidebarProvider>
      <aside
        aria-label={TEXT.sidebar}
        className="hidden shrink-0 md:sticky md:top-0 md:block md:h-svh"
      >
        <Sidebar collapsible="none" className="border-r">
          <SidebarHeader className="gap-1 p-4">
            <p
              translate="no"
              className="text-sm font-medium text-muted-foreground"
            >
              {PRODUCT_NAME}
            </p>
            <p className="text-base font-semibold break-words">
              {location.name}
            </p>
            <p className="text-sm break-words text-muted-foreground">
              {organization.name}
            </p>
          </SidebarHeader>
          <SidebarContent>
            <SidebarNav sections={sections} />
            {model.canSwitchLocation ? (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild size="lg">
                        <Link href={LOCATIONS_PATH}>
                          <span>{TEXT.switchLocation}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}
          </SidebarContent>
          <SidebarFooter className="gap-3 border-t p-4">
            <p className="text-sm font-medium break-words">{userName}</p>
            <LogoutButton />
          </SidebarFooter>
        </Sidebar>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-col gap-0.5 border-b bg-background px-4 py-3 md:hidden">
          <p className="truncate text-base font-semibold">{location.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            <span>{userName}</span>
            <span aria-hidden="true"> · </span>
            <span>{organization.name}</span>
          </p>
        </header>

        <SidebarInset id="contenido">
          {organization.writable ? null : (
            <SuspendedBanner organizationName={organization.name} />
          )}
          {children}
        </SidebarInset>

        <BottomNav sections={sections}>
          <AccountSheet
            userName={userName}
            locationName={location.name}
            organizationName={organization.name}
            canSwitchLocation={model.canSwitchLocation}
          />
        </BottomNav>
      </div>
    </SidebarProvider>
  );
}
