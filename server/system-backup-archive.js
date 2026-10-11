import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createHash, createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { createGzip, createGunzip } from "node:zlib";
import { open as openFile, readFile } from "node:fs/promises";

const scrypt = promisify(scryptCallback);
const MAGIC = Buffer.from("TZBAK01\0", "ascii");
const AUTH_TAG_BYTES = 16;
const MAX_HEADER_BYTES = 64 * 1024;
const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 20_000,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxEntryBytes: 4 * 1024 * 1024 * 1024,
});
const ALLOWED_TOP_LEVEL = new Set(["manifest.json", "README.txt", ".env", "cache"]);

function safeUnlink(path) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best-effort cleanup; the original error is more useful to the caller.
  }
}

function normalizePassword(password) {
  const value = Buffer.isBuffer(password) ? Buffer.from(password) : Buffer.from(String(password || ""), "utf8");
  if (value.length < 12) throw new Error("Backup password must be at least 12 bytes");
  return value;
}

async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new Error("Unable to write backup data");
    offset += bytesWritten;
  }
}

export function validateArchivePath(input) {
  const value = String(input || "");
  if (!value || value.includes("\0") || value.includes("\\") || isAbsolute(value)) {
    throw new Error("Unsafe archive path");
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Unsafe archive path");
  }
  const topLevel = normalized.split("/")[0];
  if (!ALLOWED_TOP_LEVEL.has(topLevel)) throw new Error("Archive path is outside the allowed roots");
  if (topLevel !== "cache" && normalized.includes("/")) throw new Error("Archive file must be at the package root");
  return normalized;
}

function targetPathFor(root, archivePath) {
  const normalized = validateArchivePath(archivePath);
  const target = resolve(root, ...normalized.split("/"));
  const rootPrefix = `${resolve(root)}${sep}`;
  if (!target.startsWith(rootPrefix)) throw new Error("Archive target escaped extraction root");
  return target;
}

function encodeFrameHeader(header) {
  const body = Buffer.from(JSON.stringify(header), "utf8");
  if (body.length > MAX_HEADER_BYTES) throw new Error("Archive frame header is too large");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(body.length);
  return [length, body];
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function collectSourceFiles(sources) {
  const output = [];

  async function visit(sourcePath, archivePath) {
    validateArchivePath(archivePath);
    const info = lstatSync(sourcePath);
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${archivePath}`);
    if (info.isDirectory()) {
      for (const name of readdirSync(sourcePath).sort((a, b) => a.localeCompare(b))) {
        await visit(resolve(sourcePath, name), `${archivePath}/${name}`);
      }
      return;
    }
    if (!info.isFile()) throw new Error(`Unsupported file type: ${archivePath}`);
    output.push({
      archivePath,
      sourcePath,
      size: info.size,
      mode: info.mode & 0o777,
      mtimeMs: Math.trunc(info.mtimeMs),
      sha256: await hashFile(sourcePath),
    });
  }

  for (const source of sources) {
    if (!source?.sourcePath || !source?.archivePath) throw new Error("Each backup source needs sourcePath and archivePath");
    if (!existsSync(source.sourcePath)) {
      if (source.required === false) continue;
      throw new Error(`Backup source does not exist: ${source.archivePath}`);
    }
    await visit(resolve(source.sourcePath), validateArchivePath(source.archivePath));
  }
  return output.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

async function* archiveChunks(records, onProgress) {
  let completedBytes = 0;
  for (const record of records) {
    const [length, header] = encodeFrameHeader({
      path: record.archivePath,
      type: "file",
      size: record.size,
      mode: record.mode,
      mtimeMs: record.mtimeMs,
      sha256: record.sha256,
    });
    yield length;
    yield header;
    if (record.buffer) {
      yield record.buffer;
      completedBytes += record.buffer.length;
      onProgress?.({ phase: "encrypting", completedBytes, currentPath: record.archivePath });
      continue;
    }
    for await (const chunk of createReadStream(record.sourcePath)) {
      completedBytes += chunk.length;
      yield chunk;
      onProgress?.({ phase: "encrypting", completedBytes, currentPath: record.archivePath });
    }
  }
  const [length, header] = encodeFrameHeader({ type: "end" });
  yield length;
  yield header;
}

function bufferRecord(archivePath, buffer) {
  return {
    archivePath,
    buffer,
    size: buffer.length,
    mode: 0o600,
    mtimeMs: Date.now(),
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function deriveKey(password, salt, parameters) {
  return scrypt(password, salt, 32, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    maxmem: 64 * 1024 * 1024,
  });
}

export async function createEncryptedBackup({
  destinationPath,
  password,
  sources,
  manifest = {},
  readme = "Tongzhou Supply Chain Center encrypted system backup.\n",
  onProgress,
}) {
  if (!destinationPath) throw new Error("destinationPath is required");
  if (existsSync(destinationPath)) throw new Error("Backup destination already exists");
  const passwordBytes = normalizePassword(password);
  const files = await collectSourceFiles(sources || []);
  const totalSourceBytes = files.reduce((sum, item) => sum + item.size, 0);
  const completedManifest = {
    format: "tongzhou-system-backup",
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    ...manifest,
    files: files.map(({ archivePath: path, size, sha256 }) => ({ path, size, sha256 })),
    fileCount: files.length,
    totalBytes: totalSourceBytes,
  };
  const manifestBuffer = Buffer.from(`${JSON.stringify(completedManifest, null, 2)}\n`, "utf8");
  const readmeBuffer = Buffer.from(String(readme), "utf8");
  const records = [
    bufferRecord("manifest.json", manifestBuffer),
    bufferRecord("README.txt", readmeBuffer),
    ...files,
  ];

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kdf = { name: "scrypt", N: 16_384, r: 8, p: 1 };
  const outerHeader = Buffer.from(JSON.stringify({
    formatVersion: 1,
    cipher: "aes-256-gcm",
    kdf,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    estimatedPlainBytes: totalSourceBytes,
    fileCount: records.length,
  }), "utf8");
  if (outerHeader.length > MAX_HEADER_BYTES) throw new Error("Backup header is too large");
  const headerLength = Buffer.allocUnsafe(4);
  headerLength.writeUInt32BE(outerHeader.length);
  const prelude = Buffer.concat([MAGIC, headerLength, outerHeader]);
  const key = await deriveKey(passwordBytes, salt, kdf);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(prelude);
  const gzip = createGzip({ level: 6 });
  const temporaryPath = `${destinationPath}.partial-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
  let output;

  try {
    output = await openFile(temporaryPath, "wx", 0o600);
    await writeAll(output, prelude);
    const encrypted = Readable.from(archiveChunks(records, onProgress)).pipe(gzip).pipe(cipher);
    for await (const chunk of encrypted) await writeAll(output, chunk);
    await writeAll(output, cipher.getAuthTag());
    await output.sync();
    await output.close();
    output = null;
    renameSync(temporaryPath, destinationPath);
    chmodSync(destinationPath, 0o600);
    return { manifest: completedManifest, bytes: statSync(destinationPath).size };
  } catch (error) {
    await output?.close().catch(() => {});
    safeUnlink(temporaryPath);
    throw error;
  } finally {
    key.fill(0);
    passwordBytes.fill(0);
  }
}

function readPrelude(packagePath) {
  const size = statSync(packagePath).size;
  if (size < MAGIC.length + 4 + AUTH_TAG_BYTES) throw new Error("Backup package is truncated");
  const fd = openSync(packagePath, "r");
  try {
    const prefix = Buffer.alloc(MAGIC.length + 4);
    if (readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) throw new Error("Backup package is truncated");
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Unsupported backup package format");
    const headerLength = prefix.readUInt32BE(MAGIC.length);
    if (!headerLength || headerLength > MAX_HEADER_BYTES) throw new Error("Invalid backup package header");
    if (size < prefix.length + headerLength + AUTH_TAG_BYTES) throw new Error("Backup package is truncated");
    const headerBuffer = Buffer.alloc(headerLength);
    if (readSync(fd, headerBuffer, 0, headerLength, prefix.length) !== headerLength) throw new Error("Backup package is truncated");
    const authTag = Buffer.alloc(AUTH_TAG_BYTES);
    if (readSync(fd, authTag, 0, AUTH_TAG_BYTES, size - AUTH_TAG_BYTES) !== AUTH_TAG_BYTES) throw new Error("Backup package is truncated");
    let header;
    try {
      header = JSON.parse(headerBuffer.toString("utf8"));
    } catch {
      throw new Error("Invalid backup package header");
    }
    return {
      size,
      header,
      authTag,
      prelude: Buffer.concat([prefix, headerBuffer]),
      bodyStart: prefix.length + headerLength,
      bodyEnd: size - AUTH_TAG_BYTES - 1,
    };
  } finally {
    closeSync(fd);
  }
}

class AsyncByteReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.done = false;
  }

  async ensure(count) {
    while (this.buffer.length < count && !this.done) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        break;
      }
      const chunk = Buffer.from(next.value);
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    }
    if (this.buffer.length < count) throw new Error("Backup archive is truncated");
  }

  async readExact(count) {
    await this.ensure(count);
    const value = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return value;
  }

  async consume(count, consumer) {
    let remaining = count;
    while (remaining > 0) {
      if (!this.buffer.length) await this.ensure(1);
      const length = Math.min(remaining, this.buffer.length);
      const chunk = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      await consumer(chunk);
      remaining -= length;
    }
  }
}

export async function extractEncryptedBackup({
  packagePath,
  destinationDir,
  password,
  limits = {},
  onProgress,
}) {
  const passwordBytes = normalizePassword(password);
  const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
  const packageInfo = readPrelude(packagePath);
  const { header } = packageInfo;
  if (header.formatVersion !== 1 || header.cipher !== "aes-256-gcm" || header.kdf?.name !== "scrypt") {
    throw new Error("Unsupported backup cryptography settings");
  }
  const salt = Buffer.from(String(header.salt || ""), "base64");
  const iv = Buffer.from(String(header.iv || ""), "base64");
  if (salt.length !== 16 || iv.length !== 12) throw new Error("Invalid backup cryptography settings");
  if (header.kdf.N !== 16_384 || header.kdf.r !== 8 || header.kdf.p !== 1) {
    throw new Error("Unsupported backup key derivation settings");
  }
  const key = await deriveKey(passwordBytes, salt, header.kdf);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(packageInfo.prelude);
  decipher.setAuthTag(packageInfo.authTag);
  const gunzip = createGunzip();
  const input = createReadStream(packagePath, { start: packageInfo.bodyStart, end: packageInfo.bodyEnd });
  input.on("error", (error) => decipher.destroy(error));
  decipher.on("error", (error) => gunzip.destroy(error));
  const decrypted = input.pipe(decipher).pipe(gunzip);
  const reader = new AsyncByteReader(decrypted);
  const seen = new Set();
  const extractedFiles = [];
  let totalBytes = 0;
  let ended = false;

  rmSync(destinationDir, { recursive: true, force: true });
  mkdirSync(destinationDir, { recursive: true, mode: 0o700 });

  try {
    while (!ended) {
      const frameLength = (await reader.readExact(4)).readUInt32BE(0);
      if (!frameLength || frameLength > MAX_HEADER_BYTES) throw new Error("Invalid archive frame header");
      let frame;
      try {
        frame = JSON.parse((await reader.readExact(frameLength)).toString("utf8"));
      } catch {
        throw new Error("Invalid archive frame header");
      }
      if (frame.type === "end") {
        ended = true;
        break;
      }
      if (frame.type !== "file") throw new Error("Unsupported archive entry type");
      const archivePath = validateArchivePath(frame.path);
      if (seen.has(archivePath)) throw new Error("Duplicate archive path");
      seen.add(archivePath);
      if (seen.size > effectiveLimits.maxFiles) throw new Error("Backup contains too many files");
      if (!Number.isSafeInteger(frame.size) || frame.size < 0 || frame.size > effectiveLimits.maxEntryBytes) {
        throw new Error("Backup entry exceeds the allowed size");
      }
      if (archivePath === "manifest.json" && frame.size > 4 * 1024 * 1024) throw new Error("Backup manifest is too large");
      if (archivePath === "README.txt" && frame.size > 1024 * 1024) throw new Error("Backup README is too large");
      if (archivePath === ".env" && frame.size > 10 * 1024 * 1024) throw new Error("Backup environment file is too large");
      totalBytes += frame.size;
      if (totalBytes > effectiveLimits.maxTotalBytes) throw new Error("Backup exceeds the allowed extracted size");
      if (!/^[a-f0-9]{64}$/.test(String(frame.sha256 || ""))) throw new Error("Backup entry checksum is invalid");

      const target = targetPathFor(destinationDir, archivePath);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      let output = await openFile(target, "wx", 0o600);
      const hash = createHash("sha256");
      try {
        await reader.consume(frame.size, async (chunk) => {
          hash.update(chunk);
          await writeAll(output, chunk);
        });
        await output.close();
        output = null;
      } catch (error) {
        await output?.close().catch(() => {});
        throw error;
      }
      if (hash.digest("hex") !== frame.sha256) throw new Error(`Checksum mismatch: ${archivePath}`);
      extractedFiles.push({ path: archivePath, size: frame.size, sha256: frame.sha256 });
      onProgress?.({ phase: "extracting", completedBytes: totalBytes, currentPath: archivePath });
    }

    // Authentication errors are raised only after the encrypted stream is fully consumed.
    if (reader.buffer.length) throw new Error("Unexpected data after archive end");
    while (!reader.done) {
      const next = await reader.iterator.next();
      if (next.done) reader.done = true;
      else if (next.value?.length) throw new Error("Unexpected data after archive end");
    }

    const manifestPath = resolve(destinationDir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error("Backup manifest is missing");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.format !== "tongzhou-system-backup" || manifest.formatVersion !== 1) {
      throw new Error("Unsupported backup manifest");
    }
    const actualByPath = new Map(extractedFiles.map((item) => [item.path, item]));
    const expectedFiles = Array.isArray(manifest.files) ? manifest.files : [];
    for (const expected of expectedFiles) {
      const actual = actualByPath.get(expected.path);
      if (!actual || actual.size !== expected.size || actual.sha256 !== expected.sha256) {
        throw new Error(`Manifest mismatch: ${expected.path}`);
      }
    }
    const payloadFiles = extractedFiles.filter((item) => !["manifest.json", "README.txt"].includes(item.path));
    if (payloadFiles.length !== expectedFiles.length) throw new Error("Manifest file count does not match the archive");
    return { header, manifest, files: extractedFiles, totalBytes };
  } catch (error) {
    decrypted.destroy();
    input.destroy();
    rmSync(destinationDir, { recursive: true, force: true });
    throw error;
  } finally {
    key.fill(0);
    passwordBytes.fill(0);
  }
}

export function inspectBackupHeader(packagePath) {
  const { header, size } = readPrelude(packagePath);
  return { ...header, packageBytes: size, fileName: basename(packagePath) };
}
