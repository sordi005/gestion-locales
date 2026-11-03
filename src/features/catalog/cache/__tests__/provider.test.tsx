import { act, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCatalogIndex } from "../domain/catalog-index";
import type { CatalogSyncDeps, CatalogSyncSnapshot } from "../sync";
import { CatalogCacheProvider, useCatalogCache } from "../provider";
import {
  LOCATION_ID,
  ORGANIZATION_ID,
  OTHER_LOCATION_ID,
  OTHER_ORGANIZATION_ID,
  USER_ID,
  makeBarcode,
  makeCategory,
  makeProduct,
} from "./fixtures";

// Spec catalog-local-cache "Disparadores de sincronización y una sola a la vez" y
// "Montaje en el local y API para otras features" (D10). El orquestador
// (`createCatalogSync`) se simula con un doble controlable: lo que se prueba acá
// es CUÁNDO el provider sincroniza y qué expone el hook, no la sincronización.

type FakeSync = {
  deps: CatalogSyncDeps;
  sync: ReturnType<typeof vi.fn<() => Promise<string>>>;
  destroy: ReturnType<typeof vi.fn<() => void>>;
  snapshot: CatalogSyncSnapshot;
  setSnapshot(next: Partial<CatalogSyncSnapshot>): void;
  api: {
    sync: () => Promise<string>;
    getSnapshot: () => CatalogSyncSnapshot;
    subscribe: (listener: () => void) => () => void;
    destroy: () => void;
  };
};

const fakes = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("../sync", () => ({
  createCatalogSync: vi.fn((deps: CatalogSyncDeps) => {
    const listeners = new Set<() => void>();
    const fake = {
      deps,
      snapshot: {
        status: "loading",
        lastSyncedAt: null,
        index: null,
        earlyRetryPending: false,
      },
      sync: vi.fn(async () => "success"),
      destroy: vi.fn(),
      setSnapshot(next: object) {
        fake.snapshot = { ...fake.snapshot, ...next };
        for (const listener of [...listeners]) listener();
      },
      api: {
        sync: () => fake.sync(),
        getSnapshot: () => fake.snapshot,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        destroy: () => fake.destroy(),
      },
    };
    fakes.instances.push(fake);
    return fake.api;
  }),
}));
vi.mock("../channel", () => ({ openCatalogChannel: () => null }));

const instances = () => fakes.instances as FakeSync[];
const current = (): FakeSync => {
  const last = instances().at(-1);
  if (last === undefined)
    throw new Error("el provider no creó la sincronización");
  return last;
};

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

function wrapper(
  ids: { userId?: string; organizationId?: string; locationId?: string } = {},
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CatalogCacheProvider
        userId={ids.userId ?? USER_ID}
        organizationId={ids.organizationId ?? ORGANIZATION_ID}
        locationId={ids.locationId ?? LOCATION_ID}
      >
        {children}
      </CatalogCacheProvider>
    );
  };
}

beforeEach(() => {
  fakes.instances.length = 0;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Vuelve el getter original de jsdom.
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe("useCatalogCache fuera del provider", () => {
  it("lanza un error que nombra a CatalogCacheProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useCatalogCache())).toThrow(
      /CatalogCacheProvider/,
    );
  });
});

describe("CatalogCacheProvider: montaje", () => {
  it("sincroniza al montarse, con los ids de la persona, la organización y el local", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });

    expect(instances()).toHaveLength(1);
    expect(current().sync).toHaveBeenCalledTimes(1);
    expect(current().deps.scope).toEqual({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      locationId: LOCATION_ID,
    });
  });

  it("no dibuja nada propio: solo sus hijos", () => {
    const { container } = render(
      <CatalogCacheProvider
        userId={USER_ID}
        organizationId={ORGANIZATION_ID}
        locationId={LOCATION_ID}
      >
        <p>contenido del local</p>
      </CatalogCacheProvider>,
    );

    expect(screen.getByText("contenido del local")).toBeVisible();
    expect(container.innerHTML).toBe("<p>contenido del local</p>");
  });

  it("al renderizar en el servidor no toca IndexedDB ni sincroniza (los efectos no corren)", () => {
    const html = renderToString(
      <CatalogCacheProvider
        userId={USER_ID}
        organizationId={ORGANIZATION_ID}
        locationId={LOCATION_ID}
      >
        <p>hijo</p>
      </CatalogCacheProvider>,
    );

    expect(html).toBe("<p>hijo</p>");
    expect(instances()).toHaveLength(0);
  });

  it("al desmontarse descarta la sincronización y deja de escuchar todo", () => {
    const { unmount } = renderHook(() => useCatalogCache(), {
      wrapper: wrapper(),
    });
    const fake = current();
    fake.sync.mockClear();

    unmount();
    setVisibility("visible");
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(5 * 60_000);

    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.sync).not.toHaveBeenCalled();
  });

  it.each([
    ["la organización", { organizationId: OTHER_ORGANIZATION_ID }],
    ["el local", { locationId: OTHER_LOCATION_ID }],
    ["la persona", { userId: "00000000-0000-4000-9000-000000000002" }],
  ])(
    "si cambia %s arma una sincronización nueva y descarta la anterior (nunca conviven dos)",
    (_name, change) => {
      const ids = {
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        locationId: LOCATION_ID,
      };
      const { rerender } = render(
        <CatalogCacheProvider {...ids}>
          <p>hijo</p>
        </CatalogCacheProvider>,
      );
      const first = current();

      rerender(
        <CatalogCacheProvider {...ids} {...change}>
          <p>hijo</p>
        </CatalogCacheProvider>,
      );

      expect(instances()).toHaveLength(2);
      expect(first.destroy).toHaveBeenCalledTimes(1);
      expect(current().deps.scope).toEqual({ ...ids, ...change });
      expect(current().sync).toHaveBeenCalledTimes(1);
    },
  );

  it("al cambiar de organización no se ve ni un instante el catálogo de la anterior", () => {
    const product = makeProduct(1, { name: "Alfajor" });
    const probe: { current: ReturnType<typeof useCatalogCache> | null } = {
      current: null,
    };
    function Probe() {
      probe.current = useCatalogCache();
      return null;
    }
    const tree = (organizationId: string) => (
      <CatalogCacheProvider
        userId={USER_ID}
        organizationId={organizationId}
        locationId={LOCATION_ID}
      >
        <Probe />
      </CatalogCacheProvider>
    );
    const { rerender } = render(tree(ORGANIZATION_ID));
    act(() =>
      current().setSnapshot({
        status: "ready",
        lastSyncedAt: 99,
        index: buildCatalogIndex([product], [], []),
      }),
    );
    expect(probe.current?.search("alfajor")).toHaveLength(1);

    rerender(tree(OTHER_ORGANIZATION_ID));

    expect(probe.current?.status).toBe("loading");
    expect(probe.current?.lastSyncedAt).toBeNull();
    expect(probe.current?.search("alfajor")).toEqual([]);
  });

  it("un render nuevo con los mismos ids no rearma nada", () => {
    const ids = {
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      locationId: LOCATION_ID,
    };
    const { rerender } = render(
      <CatalogCacheProvider {...ids}>
        <p>uno</p>
      </CatalogCacheProvider>,
    );

    rerender(
      <CatalogCacheProvider {...ids}>
        <p>dos</p>
      </CatalogCacheProvider>,
    );

    expect(instances()).toHaveLength(1);
    expect(current().destroy).not.toHaveBeenCalled();
  });
});

describe("CatalogCacheProvider: disparadores", () => {
  it("al volver la pestaña a visible sincroniza; al ocultarse no", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    fake.sync.mockClear();

    act(() => setVisibility("hidden"));
    expect(fake.sync).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    expect(fake.sync).toHaveBeenCalledTimes(1);
  });

  it("al volver la conexión (online) sincroniza", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    fake.sync.mockClear();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(fake.sync).toHaveBeenCalledTimes(1);
  });

  it("cada 60 segundos sincroniza mientras la pestaña está visible", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(fake.sync).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(fake.sync).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(fake.sync).toHaveBeenCalledTimes(3);
  });

  it("con la pestaña oculta durante 5 minutos no hace ninguna sincronización por el intervalo", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() => setVisibility("hidden"));
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(fake.sync).not.toHaveBeenCalled();
  });

  it("con el estado no-access el intervalo ya no pide nada", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() => fake.setSnapshot({ status: "no-access" }));
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(30 * 60_000);
    });

    expect(fake.sync).not.toHaveBeenCalled();
  });

  it("con el estado unauthenticated el intervalo baja el ritmo: reintenta cada 5 minutos, no cada minuto", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() => fake.setSnapshot({ status: "unauthenticated" }));
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(4 * 60_000 + 59_000);
    });
    expect(fake.sync).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(fake.sync).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(fake.sync).toHaveBeenCalledTimes(2);
  });

  it("tras un cierre de sesión ajeno (reintento temprano pendiente) reintenta en el próximo ciclo de 60 s, UNA vez, y después vuelve a los 5 minutos", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() =>
      fake.setSnapshot({ status: "unauthenticated", earlyRetryPending: true }),
    );
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(fake.sync).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(fake.sync).toHaveBeenCalledTimes(1);

    // El intento terminó con 401: el reintento temprano se gastó y sigue sin sesión.
    act(() =>
      fake.setSnapshot({ status: "unauthenticated", earlyRetryPending: false }),
    );
    act(() => {
      vi.advanceTimersByTime(4 * 60_000 + 59_000);
    });
    expect(fake.sync).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(fake.sync).toHaveBeenCalledTimes(2);
  });

  it("el reintento temprano llega aunque ya hubieran pasado ticks lentos (no espera a completar los 5 minutos)", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() => fake.setSnapshot({ status: "unauthenticated" }));
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    fake.sync.mockClear();

    act(() =>
      fake.setSnapshot({ status: "unauthenticated", earlyRetryPending: true }),
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fake.sync).toHaveBeenCalledTimes(1);
  });

  it("con el reintento temprano pendiente pero la pestaña oculta no sincroniza (el aviso no cambia la regla de visibilidad)", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() =>
      fake.setSnapshot({ status: "unauthenticated", earlyRetryPending: true }),
    );
    act(() => setVisibility("hidden"));
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(fake.sync).not.toHaveBeenCalled();
  });

  it("un no-access nunca hace el reintento temprano por el intervalo", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() =>
      fake.setSnapshot({ status: "no-access", earlyRetryPending: true }),
    );
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(fake.sync).not.toHaveBeenCalled();
  });

  it("unauthenticated con la pestaña oculta no reintenta", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() => fake.setSnapshot({ status: "unauthenticated" }));
    act(() => setVisibility("hidden"));
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(20 * 60_000);
    });

    expect(fake.sync).not.toHaveBeenCalled();
  });

  it("al recuperarse de unauthenticated vuelve el ritmo de cada minuto", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() => fake.setSnapshot({ status: "unauthenticated" }));
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    act(() => fake.setSnapshot({ status: "ready" }));
    fake.sync.mockClear();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fake.sync).toHaveBeenCalledTimes(1);
  });

  it("el cambio de pestaña oculta a visible sincroniza aunque esté unauthenticated", () => {
    renderHook(() => useCatalogCache(), { wrapper: wrapper() });
    const fake = current();
    act(() => fake.setSnapshot({ status: "unauthenticated" }));
    act(() => setVisibility("hidden"));
    fake.sync.mockClear();

    act(() => setVisibility("visible"));

    expect(fake.sync).toHaveBeenCalledTimes(1);
  });

  it.each(["ready", "stale", "memory-only", "loading"] as const)(
    "con el estado %s el intervalo sigue sincronizando",
    (status) => {
      renderHook(() => useCatalogCache(), { wrapper: wrapper() });
      const fake = current();
      act(() => fake.setSnapshot({ status }));
      fake.sync.mockClear();

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(fake.sync).toHaveBeenCalledTimes(1);
    },
  );
});

describe("useCatalogCache: lo que expone", () => {
  const alfajor = makeProduct(1, { name: "Alfajor", brand: "Arcor" });
  const gaseosa = makeProduct(2, {
    name: "Gaseosa cola",
    salePriceCents: null,
  });
  const index = buildCatalogIndex(
    [alfajor, gaseosa],
    [makeBarcode(1, alfajor.id, "7790001000019")],
    [makeCategory(1)],
  );

  it("antes de tener datos: loading, sin última sincronización y búsquedas vacías", () => {
    const { result } = renderHook(() => useCatalogCache(), {
      wrapper: wrapper(),
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.lastSyncedAt).toBeNull();
    expect(result.current.search("alfajor")).toEqual([]);
    expect(result.current.findByBarcode("7790001000019")).toBeNull();
  });

  it("search y findByBarcode usan el índice actual, y se actualizan cuando cambia", () => {
    const { result } = renderHook(() => useCatalogCache(), {
      wrapper: wrapper(),
    });

    act(() =>
      current().setSnapshot({ status: "ready", lastSyncedAt: 1234, index }),
    );

    expect(result.current.status).toBe("ready");
    expect(result.current.lastSyncedAt).toBe(1234);
    expect(result.current.search("alfajor").map((p) => p.id)).toEqual([
      alfajor.id,
    ]);
    // Sin precio: aparece, marcado con `salePriceCents: null`.
    expect(result.current.search("gaseosa")[0]?.salePriceCents).toBeNull();
    // Con y sin el 0 inicial es el mismo producto.
    expect(result.current.findByBarcode("7790001000019")?.id).toBe(alfajor.id);
    expect(result.current.findByBarcode("07790001000019")?.id).toBe(alfajor.id);
    expect(result.current.findByBarcode("7791234567890")).toBeNull();

    const newer = buildCatalogIndex(
      [makeProduct(3, { name: "Turrón de maní" })],
      [],
      [],
    );
    act(() => current().setSnapshot({ index: newer }));
    expect(result.current.search("turron mani")).toHaveLength(1);
    expect(result.current.search("alfajor")).toEqual([]);
  });

  it("search devuelve a lo sumo 50 resultados", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      makeProduct(i + 1, { name: `Galletita ${i + 1}` }),
    );
    const { result } = renderHook(() => useCatalogCache(), {
      wrapper: wrapper(),
    });

    act(() =>
      current().setSnapshot({
        status: "ready",
        index: buildCatalogIndex(many, [], []),
      }),
    );

    expect(result.current.search("galletita")).toHaveLength(50);
  });

  it("refresh() devuelve la promesa de la sincronización", async () => {
    const { result } = renderHook(() => useCatalogCache(), {
      wrapper: wrapper(),
    });
    const fake = current();
    fake.sync.mockClear();
    let finish: (value: string) => void = () => {};
    fake.sync.mockImplementation(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );

    let settled = false;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.refresh().then(() => {
        settled = true;
      });
    });
    expect(fake.sync).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await act(async () => {
      finish("success");
      await pending;
    });

    expect(settled).toBe(true);
  });

  it("refresh es estable entre renders (se puede usar en dependencias de efectos)", () => {
    const { result } = renderHook(() => useCatalogCache(), {
      wrapper: wrapper(),
    });
    const first = result.current.refresh;

    act(() => current().setSnapshot({ status: "ready" }));

    expect(result.current.refresh).toBe(first);
  });
});
