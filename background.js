const FORMATS = {
  png: {
    title: "PNG",
    mime: "image/png",
    extension: "png"
  },
  jpeg: {
    title: "JPEG",
    mime: "image/jpeg",
    extension: "jpg",
    quality: 0.92,
    fill: "#ffffff"
  },
  webp: {
    title: "WebP",
    mime: "image/webp",
    extension: "webp",
    quality: 0.9
  },
  gif: {
    title: "GIF",
    mime: "image/gif",
    extension: "gif",
    fill: "#ffffff"
  },
  avif: {
    title: "AVIF",
    mime: "image/avif",
    extension: "avif",
    quality: 0.85
  },
  bmp: {
    title: "BMP",
    mime: "image/bmp",
    extension: "bmp"
  }
};

browser.menus.removeAll().then(createMenus);

function createMenus() {
  browser.menus.create({
    id: "save-image-as-format",
    title: "Save image as format",
    contexts: ["image"]
  });

  for (const [id, format] of Object.entries(FORMATS)) {
    browser.menus.create({
      id: `save-image-as-format-${id}`,
      parentId: "save-image-as-format",
      title: format.title,
      contexts: ["image"]
    });
  }
}

browser.menus.onClicked.addListener((info) => {
  if (!info.menuItemId.startsWith("save-image-as-format-") || !info.srcUrl) {
    return;
  }

  const formatId = info.menuItemId.replace("save-image-as-format-", "");
  convertAndDownload(info.srcUrl, FORMATS[formatId]).catch((error) => {
    console.error("Save Image as Format failed:", error);
    browser.notifications?.create({
      type: "basic",
      title: "Save Image as Format",
      message: error.message || "Unable to convert this image."
    });
  });
});

async function convertAndDownload(srcUrl, format) {
  if (!format) {
    throw new Error("Unknown output format.");
  }

  const sourceBlob = await fetchImageBlob(srcUrl);
  const image = await decodeImage(sourceBlob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext("2d", {
    willReadFrequently: format.mime === "image/bmp" || format.mime === "image/gif"
  });
  if (!context) {
    throw new Error("Unable to create a canvas for conversion.");
  }

  if (format.fill) {
    context.fillStyle = format.fill;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.drawImage(image, 0, 0);

  const outputBlob = convertCanvas(canvas, context, format);
  const resolvedBlob = outputBlob instanceof Promise ? await outputBlob : outputBlob;

  if (resolvedBlob.type !== format.mime && !["image/bmp", "image/gif"].includes(format.mime)) {
    throw new Error(`${format.title} export is not supported by this Firefox build.`);
  }

  await downloadBlob(resolvedBlob, buildFilename(srcUrl, format.extension));
}

function convertCanvas(canvas, context, format) {
  if (format.mime === "image/bmp") {
    return canvasToBmpBlob(canvas, context);
  }

  if (format.mime === "image/gif") {
    return canvasToGifBlob(canvas, context);
  }

  return canvasToBlob(canvas, format.mime, format.quality);
}

async function fetchImageBlob(srcUrl) {
  if (srcUrl.startsWith("data:")) {
    const response = await fetch(srcUrl);
    return response.blob();
  }

  const response = await fetch(srcUrl, {
    credentials: "include",
    cache: "force-cache"
  });

  if (!response.ok) {
    throw new Error(`Image request failed with HTTP ${response.status}.`);
  }

  return response.blob();
}

function decodeImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Firefox could not decode this image."));
    };

    image.src = url;
  });
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Image conversion failed."));
      }
    }, mime, quality);
  });
}

function canvasToBmpBlob(canvas, context) {
  const width = canvas.width;
  const height = canvas.height;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const imageData = context.getImageData(0, 0, width, height).data;

  writeAscii(view, 0, "BM");
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - y - 1;
    let targetOffset = 54 + y * rowSize;

    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 4;
      const alpha = imageData[sourceOffset + 3] / 255;
      const inverseAlpha = 1 - alpha;

      view.setUint8(targetOffset, imageData[sourceOffset + 2] * alpha + 255 * inverseAlpha);
      view.setUint8(targetOffset + 1, imageData[sourceOffset + 1] * alpha + 255 * inverseAlpha);
      view.setUint8(targetOffset + 2, imageData[sourceOffset] * alpha + 255 * inverseAlpha);
      targetOffset += 3;
    }
  }

  return new Blob([buffer], { type: "image/bmp" });
}

function canvasToGifBlob(canvas, context) {
  const width = canvas.width;
  const height = canvas.height;
  const imageData = context.getImageData(0, 0, width, height).data;
  const colorIndices = new Uint8Array(width * height);
  const bytes = [];

  for (let offset = 0, pixel = 0; offset < imageData.length; offset += 4, pixel += 1) {
    const alpha = imageData[offset + 3] / 255;
    const red = Math.round(imageData[offset] * alpha + 255 * (1 - alpha));
    const green = Math.round(imageData[offset + 1] * alpha + 255 * (1 - alpha));
    const blue = Math.round(imageData[offset + 2] * alpha + 255 * (1 - alpha));

    colorIndices[pixel] = ((red & 0xe0) | ((green & 0xe0) >> 3) | (blue >> 6)) & 0xff;
  }

  pushAscii(bytes, "GIF89a");
  pushUint16(bytes, width);
  pushUint16(bytes, height);
  bytes.push(0xf7, 0, 0);

  for (let index = 0; index < 256; index += 1) {
    const red = index & 0xe0;
    const green = (index & 0x1c) << 3;
    const blue = (index & 0x03) << 6;

    bytes.push(red | (red >> 3) | (red >> 6));
    bytes.push(green | (green >> 3) | (green >> 6));
    bytes.push(blue | (blue >> 2) | (blue >> 4) | (blue >> 6));
  }

  bytes.push(0x2c);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, width);
  pushUint16(bytes, height);
  bytes.push(0);
  bytes.push(8);
  pushGifDataBlocks(bytes, lzwEncodeGif(colorIndices, 8));
  bytes.push(0x3b);

  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

function lzwEncodeGif(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const maxCode = 4095;
  let nextCode = endCode + 1;
  let codeSize = minCodeSize + 1;
  let dictionary = createGifDictionary(clearCode);
  let current = "";
  const output = new GifBitWriter();

  output.write(clearCode, codeSize);

  for (const index of indices) {
    const value = String.fromCharCode(index);
    const combined = current + value;

    if (dictionary.has(combined)) {
      current = combined;
      continue;
    }

    output.write(dictionary.get(current), codeSize);

    if (nextCode <= maxCode) {
      dictionary.set(combined, nextCode);
      nextCode += 1;

      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      output.write(clearCode, codeSize);
      dictionary = createGifDictionary(clearCode);
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
    }

    current = value;
  }

  if (current) {
    output.write(dictionary.get(current), codeSize);
  }

  output.write(endCode, codeSize);
  return output.finish();
}

function createGifDictionary(size) {
  const dictionary = new Map();

  for (let index = 0; index < size; index += 1) {
    dictionary.set(String.fromCharCode(index), index);
  }

  return dictionary;
}

class GifBitWriter {
  constructor() {
    this.bytes = [];
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  write(code, size) {
    this.bitBuffer |= code << this.bitCount;
    this.bitCount += size;

    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer >>= 8;
      this.bitCount -= 8;
    }
  }

  finish() {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer & 0xff);
    }

    return this.bytes;
  }
}

function pushGifDataBlocks(bytes, data) {
  for (let offset = 0; offset < data.length; offset += 255) {
    const block = data.slice(offset, offset + 255);
    bytes.push(block.length, ...block);
  }

  bytes.push(0);
}

function pushAscii(bytes, value) {
  for (let index = 0; index < value.length; index += 1) {
    bytes.push(value.charCodeAt(index));
  }
}

function pushUint16(bytes, value) {
  bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);

  try {
    await browser.downloads.download({
      url,
      filename,
      saveAs: true,
      conflictAction: "uniquify"
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function buildFilename(srcUrl, extension) {
  const fallback = `image.${extension}`;

  try {
    const url = new URL(srcUrl);
    const pathname = decodeURIComponent(url.pathname);
    const rawName = pathname.split("/").filter(Boolean).pop();
    if (!rawName) {
      return fallback;
    }

    const baseName = rawName
      .replace(/[?#].*$/, "")
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim();

    return `${baseName || "image"}.${extension}`;
  } catch {
    return fallback;
  }
}
