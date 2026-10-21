"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";

import { currentSectionKey } from "../domain/shell-model";
import type { ShellSection } from "../domain/shell-model";
import { SectionIcon } from "./section-icon";

// Las dos navegaciones del marco (menú lateral de PC y barra inferior del
// celular) son componentes cliente chicos solo porque necesitan la ruta actual
// (`usePathname`) para marcar la sección con `aria-current="page"`. Reciben las
// secciones ya resueltas por el servidor (`ShellModel`): nada más.

type SectionsProps = {
  sections: readonly ShellSection[];
};

/** Menú lateral (PC): un `nav` con una entrada por sección visible. */
export function SidebarNav({ sections }: SectionsProps) {
  const current = currentSectionKey(usePathname(), sections);

  return (
    <nav aria-label="Menú principal">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {sections.map((section) => (
              <SidebarMenuItem key={section.key}>
                <SidebarMenuButton
                  asChild
                  size="lg"
                  isActive={section.key === current}
                >
                  <Link
                    href={section.href}
                    aria-current={section.key === current ? "page" : undefined}
                  >
                    <SectionIcon sectionKey={section.key} />
                    <span>{section.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </nav>
  );
}

/**
 * Clases de un ítem de la barra inferior (el botón "Cuenta" las comparte).
 * `min-h-14` = 56 px: por encima de los 44 px mínimos para tocar con el dedo.
 */
export const BOTTOM_BAR_ITEM_CLASS =
  "flex min-h-14 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground touch-manipulation outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground [&_svg]:size-5 [&_svg]:shrink-0";

type BottomNavProps = SectionsProps & {
  /** Último ítem de la barra: el botón "Cuenta" (lo arma el marco). */
  children: ReactNode;
};

/** Barra inferior (celular): un `nav` con las secciones y, al final, "Cuenta". */
export function BottomNav({ sections, children }: BottomNavProps) {
  const current = currentSectionKey(usePathname(), sections);

  return (
    <nav
      aria-label="Menú inferior"
      className="sticky bottom-0 z-20 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex items-stretch gap-1 px-2 py-1">
        {sections.map((section) => (
          <li key={section.key} className="flex flex-1">
            <Link
              href={section.href}
              aria-current={section.key === current ? "page" : undefined}
              className={BOTTOM_BAR_ITEM_CLASS}
            >
              <SectionIcon sectionKey={section.key} />
              <span>{section.label}</span>
            </Link>
          </li>
        ))}
        <li className="flex flex-1">{children}</li>
      </ul>
    </nav>
  );
}
