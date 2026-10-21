import { describe, expect, it } from "vitest";

import { detectDevice } from "../device";

// User-Agents reales (formas actuales de cada navegador). Safari y Firefox no
// mandan `Sec-CH-UA-Mobile`: ahí decide solo el User-Agent.
const UA = {
  pixel7Chrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  androidFirefoxPhone:
    "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0",
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.0.0 Mobile/15E148 Safari/604.1",
  iPod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  // Un iPad con UA clásico también trae "Mobile/…": no es un celular.
  iPadSafari:
    "Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
  iPadChrome:
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.0.0 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ en Safari se anuncia como una Mac (0.3h): no se distingue.
  iPadOsDesktopClass:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  galaxyTabChrome:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  pixelTablet:
    "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  androidFirefoxTablet:
    "Mozilla/5.0 (Android 13; Tablet; rv:128.0) Gecko/128.0 Firefox/128.0",
  silkTablet:
    "Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/118.5.1 like Chrome/118.0.0.0 Safari/537.36",
  silkTabletMobileMode:
    "Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/118.5.1 like Chrome/118.0.0.0 Mobile Safari/537.36",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  chromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  firefoxWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
};

describe("detectDevice", () => {
  describe("pista Sec-CH-UA-Mobile", () => {
    it("?1 es phone", () => {
      expect(
        detectDevice({ chUaMobile: "?1", userAgent: UA.pixel7Chrome }),
      ).toBe("phone");
    });

    it("?1 es phone aunque falte el User-Agent o parezca de escritorio", () => {
      expect(detectDevice({ chUaMobile: "?1", userAgent: null })).toBe("phone");
      expect(detectDevice({ chUaMobile: "?1", userAgent: undefined })).toBe(
        "phone",
      );
      expect(
        detectDevice({ chUaMobile: "?1", userAgent: UA.chromeWindows }),
      ).toBe("phone");
    });

    it("?0 con un Chrome de escritorio es desktop", () => {
      expect(
        detectDevice({ chUaMobile: "?0", userAgent: UA.chromeWindows }),
      ).toBe("desktop");
    });
  });

  describe("User-Agent de celular", () => {
    it("?0 con un Android que dice Mobile es phone (emulación de Playwright)", () => {
      expect(
        detectDevice({ chUaMobile: "?0", userAgent: UA.pixel7Chrome }),
      ).toBe("phone");
    });

    it("Android con Mobile sin la pista es phone", () => {
      expect(
        detectDevice({ chUaMobile: null, userAgent: UA.pixel7Chrome }),
      ).toBe("phone");
    });

    it("Firefox de Android (Mobile entre paréntesis) es phone", () => {
      expect(
        detectDevice({ chUaMobile: null, userAgent: UA.androidFirefoxPhone }),
      ).toBe("phone");
    });

    it.each([
      ["iPhone con Safari", UA.iPhoneSafari],
      ["iPhone con Chrome", UA.iPhoneChrome],
      ["iPod", UA.iPod],
    ])("%s sin la pista es phone", (_name, userAgent) => {
      expect(detectDevice({ chUaMobile: null, userAgent })).toBe("phone");
    });

    it("un iPhone con ?0 sigue siendo phone: alcanza con que el User-Agent lo diga", () => {
      expect(
        detectDevice({ chUaMobile: "?0", userAgent: UA.iPhoneSafari }),
      ).toBe("phone");
    });
  });

  describe("tablets y escritorio son desktop", () => {
    it.each([
      ["iPad con Safari (UA clásico con Mobile/)", UA.iPadSafari],
      ["iPad con Chrome", UA.iPadChrome],
      ["iPadOS 13+ en Safari (se anuncia como Mac)", UA.iPadOsDesktopClass],
      ["Galaxy Tab (Android sin Mobile)", UA.galaxyTabChrome],
      ["Pixel Tablet", UA.pixelTablet],
      ["Firefox en una tablet Android", UA.androidFirefoxTablet],
      ["Kindle Silk", UA.silkTablet],
      ["Kindle Silk en modo móvil", UA.silkTabletMobileMode],
    ])("%s", (_name, userAgent) => {
      expect(detectDevice({ chUaMobile: null, userAgent })).toBe("desktop");
      expect(detectDevice({ chUaMobile: "?0", userAgent })).toBe("desktop");
    });

    it.each([
      ["Chrome de Windows", UA.chromeWindows],
      ["Chrome de Linux", UA.chromeLinux],
      ["Firefox de Windows", UA.firefoxWindows],
    ])("%s sin la pista", (_name, userAgent) => {
      expect(detectDevice({ chUaMobile: null, userAgent })).toBe("desktop");
    });
  });

  describe("valores ausentes o raros", () => {
    it("sin pista ni User-Agent es desktop", () => {
      expect(detectDevice({ chUaMobile: null, userAgent: null })).toBe(
        "desktop",
      );
      expect(detectDevice({})).toBe("desktop");
    });

    it.each(["", "   ", "?2", "1", "true", "?", "phone", "?10", "??1"])(
      "la pista %j no cuenta como celular",
      (chUaMobile) => {
        expect(detectDevice({ chUaMobile, userAgent: UA.chromeWindows })).toBe(
          "desktop",
        );
      },
    );

    it.each(["", "   ", "curl/8.0", "undefined", "😀".repeat(500)])(
      "el User-Agent %j no cuenta como celular",
      (userAgent) => {
        expect(detectDevice({ chUaMobile: null, userAgent })).toBe("desktop");
      },
    );

    it("una pista rara no tapa un User-Agent de celular", () => {
      expect(
        detectDevice({ chUaMobile: "?2", userAgent: UA.iPhoneSafari }),
      ).toBe("phone");
    });
  });
});
