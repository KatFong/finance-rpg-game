// 自動裁走 PNG 四邊透明邊界
// 用法: node tools/trim.mjs in.png [out.png]（唔俾 out 就原地覆寫）
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';

const inPath = process.argv[2];
const outPath = process.argv[3] || inPath;
const png = PNG.sync.read(readFileSync(inPath));
const { width, height, data } = png;

let minX = width, minY = height, maxX = -1, maxY = -1;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) { console.error('trim: image is fully transparent'); process.exit(1); }
const w = maxX - minX + 1, h = maxY - minY + 1;
const out = new PNG({ width: w, height: h });
PNG.bitblt(png, out, minX, minY, w, h, 0, 0);
writeFileSync(outPath, PNG.sync.write(out));
console.log(`trimmed ${outPath} ${width}x${height} -> ${w}x${h}`);
