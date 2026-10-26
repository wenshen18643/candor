import { afterEach, expect, it, vi } from "vitest";

import { stripAndExtract } from "../src/index.js";

const fixture = (): Uint8Array =>
  new Uint8Array([
    73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 15, 1, 2, 0, 4, 0, 0, 0, 67, 97, 109, 0, 0, 0, 0, 0,
  ]);
const cleanPng = (): Uint8Array =>
  Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
    ),
    (character) => character.charCodeAt(0),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads real TIFF metadata and exercises browser re-encoding with deterministic canvas doubles", async () => {
  const close = vi.fn();
  const draw = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1, height: 1, close })),
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext(): { drawImage: typeof draw } {
        return { drawImage: draw };
      }
      async convertToBlob(): Promise<Blob> {
        return new Blob([new Uint8Array(cleanPng())], { type: "image/png" });
      }
    },
  );
  const output = await stripAndExtract({
    name: "photo.tiff",
    type: "image/tiff",
    bytes: fixture(),
  });
  expect(output.metadataRemoved).toEqual(
    expect.arrayContaining([expect.objectContaining({ field: "Make", value: "Cam" })]),
  );
  expect(output.metadataRemaining).toEqual([]);
  expect(output.bytes).toEqual(cleanPng());
  expect(output.mime).toBe("image/png");
  expect(draw).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it("fails closed when a browser cannot create a drawing context and releases the bitmap", async () => {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1, height: 1, close })),
  );
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext(): null {
        return null;
      }
    },
  );
  await expect(
    stripAndExtract({ name: "photo.tiff", type: "image/tiff", bytes: fixture() }),
  ).rejects.toThrow("File sanitization failed");
  expect(close).toHaveBeenCalledOnce();
});
