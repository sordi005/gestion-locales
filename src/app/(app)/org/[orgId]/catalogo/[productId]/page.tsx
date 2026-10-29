import Link from "next/link";
import { notFound } from "next/navigation";

import {
  WARNINGS_PARAM,
  costBasisLabel,
  parseWarningsParam,
  resolveProductCost,
} from "@/features/catalog";
import {
  BarcodeList,
  PriceChangePanel,
  PriceHistory,
  ProductForm,
  ProductStatusControl,
  UnitPrice,
  catalogPath,
} from "@/features/catalog/components";
import { getProductDetail } from "@/features/catalog/server";
import { requireOrgContext } from "@/features/tenancy/server";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";

/**
 * Ficha del producto (D1, D4): datos, códigos de barras, stock mínimo por local,
 * precio e historial, venta rápida (solo lectura) y desactivar / reactivar. Llama
 * a la guarda por su cuenta. Un `productId` mal formado, inexistente o de otra
 * organización no tiene ficha (`getProductDetail` da `null`) y responde el mismo
 * 404 que todo lo demás. La ficha de administración solo existe para dueño y
 * encargado; cualquier otra no se dibuja. Tras un alta con avisos (código que no
 * se cargó, dígito verificador dudoso) llega `?avisos=` con solo el código del aviso
 * y el de barras: se valida con Zod, lo que no calza se ignora y el mensaje se arma
 * acá en castellano.
 */
export default async function ProductPage({
  params,
  searchParams,
}: PageProps<"/org/[orgId]/catalogo/[productId]">) {
  const { orgId, productId } = await params;
  const context = await requireOrgContext(orgId, ["owner", "manager"]);

  const warnings = parseWarningsParam((await searchParams)[WARNINGS_PARAM]);

  const detail = await getProductDetail(context, productId);
  if (detail === null || detail.access !== "admin") notFound();

  const { product, barcodes, minStocks, categories, suppliers, priceHistory } =
    detail;
  const writable = context.organization.writable;
  // En C-09 no hay compras (C-31/C-32): el costo es el de referencia.
  const cost = resolveProductCost({
    lastPurchaseCostCents: null,
    referenceCostCents: product.referenceCostCents,
  });
  const quickSaleButton =
    product.quickSalePosition === null
      ? null
      : product.quickSaleLabel === null
        ? `Botón ${product.quickSalePosition}`
        : `Botón ${product.quickSalePosition}: ${product.quickSaleLabel}`;

  return (
    <div className="flex max-w-3xl flex-col gap-8 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <Link
          href={catalogPath(orgId)}
          className="text-sm underline-offset-4 hover:underline"
        >
          Volver al catálogo
        </Link>
        <h1 className="text-xl font-semibold break-words">{product.name}</h1>
        <div
          role="group"
          aria-label="Estado del producto"
          className="flex flex-wrap items-center gap-2"
        >
          <Badge
            variant={product.status === "active" ? "outline" : "secondary"}
          >
            {product.status === "active" ? "Activo" : "Inactivo"}
          </Badge>
          <UnitPrice cents={product.salePriceCents} unit={product.unit} />
        </div>
      </header>

      {warnings.length === 0 ? null : (
        <Alert role="status">
          <AlertDescription>
            <p>El producto se creó, pero revisá lo siguiente:</p>
            <ul className="list-disc pl-5">
              {warnings.map((warning) => (
                <li key={`${warning.code}-${warning.barcode}`}>
                  {warning.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="ficha-datos" className="flex flex-col gap-4">
        <h2 id="ficha-datos" className="text-lg font-semibold">
          Datos del producto
        </h2>
        <ProductForm
          orgId={orgId}
          writable={writable}
          categories={categories}
          suppliers={suppliers}
          minStocks={minStocks}
          product={{
            id: product.id,
            name: product.name,
            brand: product.brand,
            categoryId: product.categoryId,
            unit: product.unit,
            tracksStock: product.tracksStock,
            tracksExpiry: product.tracksExpiry,
            referenceCostCents: product.referenceCostCents,
            referenceCostSource: product.referenceCostSource,
            preferredSupplierId: product.preferredSupplierId,
          }}
        />
      </section>

      <section
        aria-labelledby="ficha-codigos"
        className="flex flex-col gap-4 border-t pt-6"
      >
        <h2 id="ficha-codigos" className="text-lg font-semibold">
          Códigos de barras
        </h2>
        <BarcodeList
          orgId={orgId}
          productId={product.id}
          barcodes={barcodes}
          writable={writable}
        />
      </section>

      <section
        aria-labelledby="ficha-precio"
        className="flex flex-col gap-4 border-t pt-6"
      >
        <h2 id="ficha-precio" className="text-lg font-semibold">
          Precio
        </h2>
        <PriceChangePanel
          orgId={orgId}
          productId={product.id}
          unit={product.unit}
          priceCents={product.salePriceCents}
          costCents={cost.costCents}
          costBasis={costBasisLabel(cost.basis, product.referenceCostSource)}
          writable={writable}
        />
      </section>

      <section
        aria-labelledby="ficha-historial"
        className="flex flex-col gap-4 border-t pt-6"
      >
        <h2 id="ficha-historial" className="text-lg font-semibold">
          Historial de precios
        </h2>
        <PriceHistory entries={priceHistory} />
      </section>

      <section
        aria-labelledby="ficha-venta-rapida"
        className="flex flex-col gap-2 border-t pt-6"
      >
        <h2 id="ficha-venta-rapida" className="text-lg font-semibold">
          Venta rápida
        </h2>
        {quickSaleButton === null ? (
          <p className="text-sm text-muted-foreground">
            Este producto no tiene botón de venta rápida.
          </p>
        ) : (
          <p>{quickSaleButton}</p>
        )}
        <p className="text-sm text-muted-foreground">
          Los botones de venta rápida se arman más adelante; por ahora solo se
          ven acá.
        </p>
      </section>

      <section
        aria-labelledby="ficha-estado"
        className="flex flex-col gap-4 border-t pt-6"
      >
        <h2 id="ficha-estado" className="text-lg font-semibold">
          Estado
        </h2>
        <ProductStatusControl
          orgId={orgId}
          productId={product.id}
          productName={product.name}
          status={product.status}
          quickSaleButton={quickSaleButton}
          writable={writable}
        />
      </section>
    </div>
  );
}
