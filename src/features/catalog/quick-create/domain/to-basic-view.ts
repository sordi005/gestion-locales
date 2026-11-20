import type { CachedProduct } from "../../cache/domain/cached-entities";
import type { ProductBasicView } from "../../domain/product-view";

/**
 * La caché guarda también el botón de venta rápida y `updated_at`: el alta rápida y la
 * pantalla "Productos" trabajan solo con la vista básica (sin costo ni proveedor).
 */
export function toBasicView(cached: CachedProduct): ProductBasicView {
  return {
    id: cached.id,
    name: cached.name,
    brand: cached.brand,
    categoryId: cached.categoryId,
    unit: cached.unit,
    status: cached.status,
    tracksStock: cached.tracksStock,
    tracksExpiry: cached.tracksExpiry,
    salePriceCents: cached.salePriceCents,
    salePriceUpdatedAt: cached.salePriceUpdatedAt,
  };
}
