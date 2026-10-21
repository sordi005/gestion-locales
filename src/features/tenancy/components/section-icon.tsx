import {
  BookOpenIcon,
  CalendarClockIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  CreditCardIcon,
  HouseIcon,
  PackageIcon,
  ReceiptTextIcon,
  SettingsIcon,
  ShoppingCartIcon,
  StoreIcon,
  TagIcon,
  Trash2Icon,
  TruckIcon,
  UploadIcon,
  WalletIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { SectionKey } from "../domain/navigation";

// Un ícono por sección del registro. `Record<SectionKey, …>` obliga a elegir uno
// cuando alguien suma una sección al registro (el compilador avisa).
const ICONS: Record<SectionKey, LucideIcon> = {
  inicio: HouseIcon,
  vender: ShoppingCartIcon,
  caja: WalletIcon,
  ventas: ReceiptTextIcon,
  vencimientos: CalendarClockIcon,
  compras: TruckIcon,
  mermas: Trash2Icon,
  conteos: ClipboardListIcon,
  stock: PackageIcon,
  catalogo: BookOpenIcon,
  precios: TagIcon,
  proveedores: StoreIcon,
  "medios-de-pago": CreditCardIcon,
  importaciones: UploadIcon,
  configuracion: SettingsIcon,
  estadisticas: ChartColumnIcon,
};

/** Ícono decorativo de una sección (el texto del enlace es el nombre accesible). */
export function SectionIcon({ sectionKey }: { sectionKey: SectionKey }) {
  const Icon = ICONS[sectionKey];
  return <Icon aria-hidden="true" />;
}
