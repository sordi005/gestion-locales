import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

import type { CatalogSearch } from "../domain/search-params";
import type { OptionDto } from "../dto";
import { catalogPath } from "./catalog-href";

/** "Todas" no es un id: el listado la lee como "sin categoría elegida". */
const ALL_CATEGORIES = "todas";

type CatalogFiltersProps = {
  readonly orgId: string;
  /** Los filtros de la URL (ya validados): son el valor inicial del formulario. */
  readonly search: CatalogSearch;
  readonly categories: readonly OptionDto[];
};

/**
 * Filtros del listado. Es un formulario `GET` a la misma página: el estado vive
 * en la URL (se comparte, se recarga y funciona sin JavaScript) y buscar vuelve
 * a la primera página. Lo escrito no se usa acá en ninguna consulta: la página
 * lo valida con `parseCatalogSearchParams`.
 */
export function CatalogFilters({
  orgId,
  search,
  categories,
}: CatalogFiltersProps) {
  return (
    <form
      role="search"
      aria-label="Filtros"
      method="get"
      action={catalogPath(orgId)}
      className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end"
    >
      <div className="flex flex-col gap-1.5 md:min-w-64 md:flex-1">
        <Label htmlFor="catalog-filter-q">Buscar</Label>
        <Input
          id="catalog-filter-q"
          type="search"
          name="q"
          defaultValue={search.q}
          placeholder="Nombre o código de barras"
          maxLength={100}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="catalog-filter-status">Estado</Label>
        <Select
          name="estado"
          defaultValue={search.status === "inactive" ? "inactivos" : "activos"}
        >
          <SelectTrigger id="catalog-filter-status" className="w-full md:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="activos">Activos</SelectItem>
              <SelectItem value="inactivos">Inactivos</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="catalog-filter-category">Categoría</Label>
        <Select
          name="categoria"
          defaultValue={search.categoryId ?? ALL_CATEGORIES}
        >
          <SelectTrigger
            id="catalog-filter-category"
            className="w-full md:w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL_CATEGORIES}>Todas</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 md:pb-1.5">
        <Checkbox
          id="catalog-filter-without-price"
          name="sinPrecio"
          value="1"
          defaultChecked={search.withoutPrice}
        />
        <Label htmlFor="catalog-filter-without-price">Solo sin precio</Label>
      </div>

      <Button type="submit">Buscar</Button>
    </form>
  );
}
