import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { downloadZip } from "client-zip";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Remotion ZIP fallback", () => {
  it("opens and preserves the source bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "videobridge-zip-"));
    const zipPath = join(directory, "fallback.zip");
    const source = new Uint8Array([0, 1, 2, 3, 4, 250, 251, 252]);

    try {
      const response = downloadZip([
        { name: "remotion-input/source-video.mp4", input: source },
        { name: "remotion-input/manifest.json", input: JSON.stringify({ size: source.byteLength }) },
        { name: "remotion-input/README.txt", input: "source-video.mp4 is the original media asset" },
      ]);
      await writeFile(zipPath, new Uint8Array(await response.arrayBuffer()));

      await execFileAsync("unzip", ["-t", zipPath]);
      const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
      expect(stdout.trim().split("\n")).toEqual([
        "remotion-input/source-video.mp4",
        "remotion-input/manifest.json",
        "remotion-input/README.txt",
      ]);
      const { stdout: extracted } = await execFileAsync("unzip", ["-p", zipPath, "remotion-input/source-video.mp4"], {
        encoding: "buffer",
      });
      expect(Buffer.from(extracted)).toEqual(Buffer.from(source));
      expect((await readFile(zipPath)).byteLength).toBeGreaterThan(source.byteLength);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
