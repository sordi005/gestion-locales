import type { ReactNode } from "react";

import { AuthShell } from "@/features/auth/components";

// Los links de los emails (`/auth/confirm`) usan el mismo marco que el ingreso.
export default function AuthLinksLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
