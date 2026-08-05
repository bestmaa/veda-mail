import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "public", "og.png");
const output = path.join(root, "public", "icons");
const crop = { height: 720, left: 476, top: 100, width: 720 };

await Promise.all([192, 512].map((size) =>
  sharp(source)
    .extract(crop)
    .resize(size, size, { fit: "cover", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(output, `veda-mail-${size}.png`)),
));
