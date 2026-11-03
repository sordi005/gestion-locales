import { describe, expect, it } from "vitest";

import {
  CATALOG_CHANNEL_NAME,
  openCatalogChannel,
  readChannelMessage,
} from "../channel";

describe("readChannelMessage", () => {
  it.each([
    [{ type: "synced" }, { type: "synced" }],
    [
      { type: "cleared", reason: "logout" },
      { type: "cleared", reason: "logout" },
    ],
    [
      { type: "cleared", reason: "no-access" },
      { type: "cleared", reason: "no-access" },
    ],
    // Un mensaje con datos de más se reduce a lo conocido.
    [
      { type: "cleared", reason: "no-access", extra: "x" },
      { type: "cleared", reason: "no-access" },
    ],
    // Sin motivo (o con uno desconocido) vale como cierre de sesión: la lectura más
    // segura, la que no repuebla el almacén por su cuenta.
    [{ type: "cleared" }, { type: "cleared", reason: "logout" }],
    [
      { type: "cleared", reason: "otra-cosa" },
      { type: "cleared", reason: "logout" },
    ],
  ])("acepta %j", (data, expected) => {
    expect(readChannelMessage(data)).toEqual(expected);
  });

  it.each([
    ["null", null],
    ["un texto", "synced"],
    ["un número", 1],
    ["un objeto sin tipo", {}],
    ["un tipo desconocido", { type: "wipe-everything" }],
    ["un tipo que no es texto", { type: 1 }],
  ])("ignora %s", (_name, data) => {
    expect(readChannelMessage(data)).toBeNull();
  });
});

describe("openCatalogChannel", () => {
  it("abre el canal `catalog-cache` si el navegador tiene BroadcastChannel", () => {
    const channel = openCatalogChannel();

    expect(channel).not.toBeNull();
    expect(CATALOG_CHANNEL_NAME).toBe("catalog-cache");
    channel?.close();
  });
});
