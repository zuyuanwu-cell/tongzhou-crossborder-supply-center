import { createWriteStream, renameSync, unlinkSync } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { createGzip } from "node:zlib";

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

export async function writeGzipJsonArrayAtomic(targetPath, metadata, key, rows, { level = 1 } = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new TypeError("metadata must be an object");
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  const output = createWriteStream(temporaryPath, { flags: "wx" });
  const gzip = createGzip({ level });
  gzip.pipe(output);
  try {
    const header = JSON.stringify(metadata);
    await writeChunk(gzip, `${header.slice(0, -1)},${JSON.stringify(String(key))}:[`);
    for (let index = 0; index < rows.length; index += 1) {
      if (index) await writeChunk(gzip, ",");
      await writeChunk(gzip, JSON.stringify(rows[index]));
    }
    gzip.end("]}");
    await Promise.all([finished(gzip), finished(output)]);
    renameSync(temporaryPath, targetPath);
  } catch (error) {
    gzip.destroy();
    output.destroy();
    try { unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}
