// Standalone proof that the perceptual hash dedups re-uploads.
// Runs against the compiled dist/phash.js. Usage: node test/dedup-test.js
const Jimp = require('jimp');
const { computePHash, hammingDistance } = require('../dist/phash');

function makePattern(seed) {
  // deterministic, content-defined image
  const img = new Jimp(128, 128, 0x000000ff);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const v = ((x * 7 + y * 13 + seed * 50) % 256);
      const w = ((x ^ y) + seed * 30) % 256;
      const color = Jimp.rgbaToInt((v) & 255, (w) & 255, (x + y) & 255, 255);
      img.setPixelColor(color, x, y);
    }
  }
  return img;
}

async function toBuffer(img, mime) {
  return img.getBufferAsync(mime);
}

(async () => {
  const threshold = Number(process.env.PHASH_THRESHOLD || 5);

  const original = makePattern(1);
  const different = makePattern(2);

  // "Original upload" as PNG.
  const aPng = await toBuffer(original.clone(), Jimp.MIME_PNG);
  // "Re-upload": same content, re-encoded as JPEG (different bytes, would be a
  // different URL / videoId on YouTube) and slightly resized.
  const reupload = original.clone().resize(96, 96).quality(70);
  const bJpg = await toBuffer(reupload, Jimp.MIME_JPEG);
  // A genuinely different thumbnail.
  const cPng = await toBuffer(different.clone(), Jimp.MIME_PNG);

  const hA = await computePHash(aPng);
  const hB = await computePHash(bJpg);
  const hC = await computePHash(cPng);

  const dReupload = hammingDistance(hA, hB);
  const dDifferent = hammingDistance(hA, hC);

  console.log('original  pHash:', hA);
  console.log('re-upload pHash:', hB, ' distance from original =', dReupload);
  console.log('different pHash:', hC, ' distance from original =', dDifferent);
  console.log('threshold       :', threshold);

  const reuploadCaught = dReupload <= threshold;
  const differentKept = dDifferent > threshold;

  console.log('re-upload caught as duplicate :', reuploadCaught);
  console.log('different image kept distinct  :', differentKept);

  if (reuploadCaught && differentKept) {
    console.log('RESULT=PASS');
    process.exit(0);
  } else {
    console.log('RESULT=FAIL');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  console.log('RESULT=FAIL');
  process.exit(1);
});
