"use strict";

// 打包 Windows 免安装版：dist/同舟智数-<版本>-win-x64.zip
// 用法：node scripts/package-win.js [--electron-zip <本地 electron-vX-win32-x64.zip>]
// 不需要 wine：用 resedit（纯 JS）写入 exe 图标与版本信息。
// 国内网络可设置 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const electronVersion = String(pkg.devDependencies.electron).replace(/^[^\d]*/, "");
const productName = pkg.productName;
const outDir = path.join(root, "dist");
const appDirName = `${productName}-win-x64`;
const target = path.join(outDir, appDirName);
const zipName = `${productName}-${pkg.version}-win-x64.zip`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 失败（${result.status}）`);
}

async function download(url, file) {
  console.log(`下载 ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}：${url}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") run("tar", ["-xf", zip, "-C", dest]);
  else run("unzip", ["-q", "-o", zip, "-d", dest]);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, dest);
    else fs.copyFileSync(source, dest);
  }
}

async function patchExe(exePath) {
  const ResEdit = require("resedit");
  const PELibrary = require("pe-library");
  const data = fs.readFileSync(exePath);
  const exe = PELibrary.NtExecutable.from(data, { ignoreCert: true });
  const res = PELibrary.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, "build", "icon.ico")));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((item) => item.data));
  const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const version = versions[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patch] = pkg.version.split(".").map(Number);
  version.setFileVersion(major, minor, patch, 0, 1033);
  version.setProductVersion(major, minor, patch, 0, 1033);
  const strings = { ProductName: productName, FileDescription: productName, CompanyName: pkg.author || "", OriginalFilename: `${productName}.exe`, InternalName: productName, LegalCopyright: `© ${new Date().getFullYear()} ${pkg.author || ""}` };
  for (const lang of version.getAllLanguagesForStringValues()) version.setStringValues(lang, strings);
  if (!version.getAllLanguagesForStringValues().length) version.setStringValues({ lang: 1033, codepage: 1200 }, strings);
  version.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

// 自带 ZIP 写入：文件名按 UTF-8 编码并设置 UTF-8 标志位，Windows 资源管理器解压中文文件名不乱码。
function listFiles(base, rel) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(base, child));
    else out.push(child);
  }
  return out;
}

function writeZip(zipPath, base, rel) {
  const zlib = require("node:zlib");
  const fd = fs.openSync(zipPath, "w");
  const central = [];
  let offset = 0;
  const write = (buffer) => {
    fs.writeSync(fd, buffer);
    offset += buffer.length;
  };
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const file of listFiles(base, rel)) {
    const data = fs.readFileSync(path.join(base, file));
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const crc = zlib.crc32(data);
    const name = Buffer.from(file, "utf8");
    if (data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error("文件过大，需要 ZIP64");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const headerOffset = offset;
    write(local);
    write(name);
    write(body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(useDeflate ? 8 : 0, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc >>> 0, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(headerOffset, 42);
    central.push(Buffer.concat([entry, name]));
  }
  const centralStart = offset;
  for (const entry of central) write(entry);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  write(end);
  fs.closeSync(fd);
}

async function main() {
  const args = process.argv.slice(2);
  const localZipIndex = args.indexOf("--electron-zip");
  let electronZip = localZipIndex >= 0 ? path.resolve(args[localZipIndex + 1]) : "";
  if (!electronZip) {
    const cache = path.join(os.homedir(), ".cache", "tongzhou-zhishu");
    fs.mkdirSync(cache, { recursive: true });
    electronZip = path.join(cache, `electron-v${electronVersion}-win32-x64.zip`);
    if (!fs.existsSync(electronZip)) {
      const mirror = (process.env.ELECTRON_MIRROR || "https://github.com/electron/electron/releases/download/").replace(/\/?$/, "/");
      const prefix = mirror.includes("github.com") ? `v${electronVersion}` : electronVersion;
      await download(`${mirror}${prefix}/electron-v${electronVersion}-win32-x64.zip`, electronZip);
    }
  }
  fs.rmSync(target, { recursive: true, force: true });
  unzip(electronZip, target);
  fs.renameSync(path.join(target, "electron.exe"), path.join(target, `${productName}.exe`));
  fs.rmSync(path.join(target, "resources", "default_app.asar"), { force: true });
  const appDir = path.join(target, "resources", "app");
  for (const item of ["main.js", "preload.js"]) {
    fs.mkdirSync(appDir, { recursive: true });
    fs.copyFileSync(path.join(root, item), path.join(appDir, item));
  }
  for (const dir of ["core", "ui", "build"]) copyDir(path.join(root, dir), path.join(appDir, dir));
  const { devDependencies, scripts, ...runtimePkg } = pkg;
  fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(runtimePkg, null, 2));
  await patchExe(path.join(target, `${productName}.exe`));
  fs.copyFileSync(path.join(root, "使用说明.md"), path.join(target, "使用说明.md"));
  const zipPath = path.join(outDir, zipName);
  fs.rmSync(zipPath, { force: true });
  writeZip(zipPath, outDir, appDirName);
  console.log(`完成：${zipPath}（${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
