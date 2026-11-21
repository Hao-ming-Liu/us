const MIB = 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const NAMES = { meeting: "见面", post: "事件", comment: "感想", message: "留言", anniversary: "纪念日", letter: "未来信" };
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" };

function loadElement(element, url, successEvent) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      element.removeEventListener(successEvent, ready);
      element.removeEventListener("error", fail);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const fail = () => finish(new Error("浏览器无法读取这份媒体，请重新选择文件。"));
    const timer = setTimeout(fail, 20000);
    element.addEventListener(successEvent, ready);
    element.addEventListener("error", fail);
    element.src = url;
  });
}

export async function prepareMedia(file) {
  if (!(file instanceof Blob) || file.size === 0) throw new Error("请选择有内容的照片或短视频。");
  if (!VIDEO_TYPES.has(file.type) && !IMAGE_TYPES.has(file.type)) {
    throw new Error("请选择常见图片、MP4 或 WebM 视频。HEIC 照片请先转成 JPEG。");
  }
  const video = VIDEO_TYPES.has(file.type);
  if (file.size > (video ? 20 : 40) * MIB) {
    throw new Error(video ? "短视频须在 20 MiB 以内，请先裁剪或压缩。" : "照片须在 40 MiB 以内，请先缩小尺寸。");
  }
  const element = video ? document.createElement("video") : new Image();
  const url = URL.createObjectURL(file);
  try {
    if (video) {
      element.preload = "metadata";
      await loadElement(element, url, "loadedmetadata");
      if (!element.videoWidth || !Number.isFinite(element.duration) || element.duration <= 0 || element.duration > 60) {
        throw new Error("请选择时长可读取、最长 60 秒的短视频。");
      }
      return file;
    }
    await loadElement(element, url, "load");
    const { naturalWidth: width, naturalHeight: height } = element;
    if (!width || !height) throw new Error("这张照片没有可读取的画面。");
    const ratio = Math.min(1, 1920 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("浏览器无法压缩照片，请尝试更新浏览器。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.83));
    if (!compressed) throw new Error("照片压缩失败，请尝试另一张照片。");
    return new File([compressed], (file.name || "照片").replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    element.removeAttribute("src");
    if (video) element.load();
    URL.revokeObjectURL(url);
  }
}

// Store already-compressed media without re-encoding it. ZIP records and offsets are little endian.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});

async function checksum(blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
    return (crc ^ 0xffffffff) >>> 0;
  } finally {
    reader.releaseLock();
  }
}

async function zip(files, now) {
  const directory = [];
  const contents = [];
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  let offset = 0;
  let directorySize = 0;
  if (files.length >= 65535) throw new Error("备份文件数量超出 ZIP 格式限制。");
  for (const { name, blob } of files) {
    const filename = new TextEncoder().encode(name);
    const crc = await checksum(blob);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, blob.size, true);
    local.setUint32(22, blob.size, true);
    local.setUint16(26, filename.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    new Uint8Array(central.buffer).set(new Uint8Array(local.buffer, 4, 24), 6);
    central.setUint32(42, offset, true);
    contents.push(local.buffer, filename, blob);
    directory.push(central.buffer, filename);
    directorySize += central.byteLength + filename.length;
    offset += local.byteLength + filename.length + blob.size;
    if (offset + directorySize >= 0xffffffff) throw new Error("备份超过 ZIP 格式的 4 GiB 限制。");
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...contents, ...directory, end.buffer], { type: "application/zip" });
}

function attachments(data) {
  return [data.cover, ...(data.media || [])].filter(item => item?.path);
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function archivePage(rows, manifest, now, store) {
  const lookup = new Map(rows.map(row => [row.id, row]));
  const linkTo = id => {
    const parent = lookup.get(id);
    return parent ? '<a href="#' + escapeText(parent.id) + '">' + escapeText(parent.data.title || NAMES[parent.kind]) + '</a>' : "";
  };
  const articles = rows.map(row => {
    const { data } = row;
    const media = attachments(data).map(({ path }) => {
      const item = manifest.get(path);
      return item.type.startsWith("video/")
        ? '<video controls preload="metadata" src="' + item.file + '"></video>'
        : '<a href="' + item.file + '"><img loading="lazy" src="' + item.file + '" alt="随附照片"></a>';
    }).join("");
    const date = data.date ? [data.date, data.time].filter(Boolean).join(" ") : row.created_at?.slice(0, 10);
    const credit = row.author_id === store.user.id ? "我" : "对方";
    return '<article id="' + escapeText(row.id) + '"><small>' + escapeText([NAMES[row.kind], date, credit].filter(Boolean).join(" · ")) +
      '</small><h2>' + escapeText(data.title || NAMES[row.kind]) + '</h2>' + linkTo(data.meetingId || data.postId) +
      (data.summary ? '<p><b>' + escapeText(data.summary) + '</b></p>' : '') +
      '<p>' + escapeText(data.body) + '</p>' + media +
      (data.signature ? '<p>—— ' + escapeText(data.signature) + '</p>' : '') + '</article>';
  }).join("");
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>us · 离线备份</title><style>body{max-width:720px;margin:40px auto;padding:0 22px;color:#302b24;background:#faf8f3;font:17px/1.7 system-ui,sans-serif}article{border-top:1px solid #d4ccbf;padding:26px 0}h2{font:600 1.45em/1.4 serif;margin:.35em 0}small{color:#615747}a{color:#6f492f}p{white-space:pre-wrap;overflow-wrap:anywhere}img,video{max-width:100%;max-height:65vh;display:block;margin:1em 0}</style>' +
    '<h1>us · 我们的纪念册</h1><p>' + (store.demo ? "虚构的演示空间 · " : "") +
    '离线备份 · ' + escapeText(now.toLocaleDateString("zh-CN")) + ' · 共 ' + rows.length + ' 条记录</p>' +
    '<p><a href="records.json">查看完整记录数据</a></p>' + articles + '</html>';
}

export async function exportBackup(store) {
  const rows = await store.list();
  const now = new Date();
  const files = [];
  const manifest = new Map();
  for (const { data } of rows) {
    for (const { path, type } of attachments(data)) {
      if (manifest.has(path)) continue;
      const blob = await store.mediaBlob(path);
      if (!(blob instanceof Blob) || !blob.size) throw new Error("一份媒体未能读取，请重试备份。");
      const mime = EXTENSIONS[blob.type] ? blob.type : type;
      const file = "media/" + String(files.length + 1).padStart(5, "0") + "." + (EXTENSIONS[mime] || "bin");
      manifest.set(path, { path, file, type: mime || "application/octet-stream" });
      files.push({ name: file, blob });
    }
  }
  const metadata = { version: 1, exported_at: now.toISOString(), exported_by: store.user.id, records: rows, media: [...manifest.values()] };
  files.push({ name: "records.json", blob: new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }) });
  files.push({ name: "index.html", blob: new Blob([archivePage(rows, manifest, now, store)], { type: "text/html" }) });
  const result = await zip(files, now);
  const url = URL.createObjectURL(result);
  const a = document.createElement("a");
  try {
    a.href = url;
    a.download = "us-纪念册-" + now.toISOString().slice(0, 10) + ".zip";
    document.body.append(a);
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return result;
}
