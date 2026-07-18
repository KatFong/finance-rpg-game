// 將純色背景（預設 magenta #FF00FF）轉做真透明，並做邊緣去色
// 用法: node tools/chromakey.mjs in.png out.png
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';

const [, , inPath, outPath] = process.argv;
const png = PNG.sync.read(readFileSync(inPath));
const { width, height, data } = png;

// 由四個角取樣實際 key 色（生成圖嘅 magenta 未必係正 FF00FF）
function sample(x, y) { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; }
const corners = [sample(2, 2), sample(width - 3, 2), sample(2, height - 3), sample(width - 3, height - 3)];
const key = corners[0].map((_, c) => Math.round(corners.reduce((s, k) => s + k[c], 0) / 4));

const HARD = 70;   // 距離低過呢個 → 完全透明
const SOFT = 150;  // 之間 → 半透明 + 去 key 色
for (let i = 0; i < data.length; i += 4) {
  const dr = data[i] - key[0], dg = data[i + 1] - key[1], db = data[i + 2] - key[2];
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  if (dist < HARD) {
    data[i + 3] = 0;
  } else if (dist < SOFT) {
    const a = (dist - HARD) / (SOFT - HARD);
    // un-premultiply：將混入嘅 key 色除返走
    for (let c = 0; c < 3; c++) {
      const v = (data[i + c] - (1 - a) * key[c]) / a;
      data[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
    data[i + 3] = Math.round(a * 255);
  }
}
writeFileSync(outPath, PNG.sync.write(png));
console.log(`keyed ${outPath} (key rgb ${key.join(',')})`);
