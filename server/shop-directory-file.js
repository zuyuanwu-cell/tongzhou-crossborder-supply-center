const text = (value) => String(value ?? "");

function decode(bytes, encoding) {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

export function decodeShopDirectoryCsv(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode(bytes.subarray(2), "utf-16le");
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode(bytes.subarray(2), "utf-16be");
    return decode(bytes, "utf-8");
  } catch {
    try {
      return decode(bytes, "gb18030");
    } catch {
      throw new Error("CSV 编码无法识别。请从系统重新导出 Excel 文件，修改后直接上传 .xlsx。");
    }
  }
}

export function parseShopDirectoryCsv(source) {
  const input = text(source).replace(/^\uFEFF+/, "");
  if (input.includes("\uFFFD")) throw new Error("CSV 编码无法识别。请从系统重新导出 Excel 文件，修改后直接上传 .xlsx。");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value.trim());
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (quoted) throw new Error("CSV 存在未闭合的双引号，请检查文件格式。");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function containsQuestionMarkEncodingDamage(values) {
  return (Array.isArray(values) ? values : []).some((value) => /\?{2,}/.test(text(value)));
}
