import Jimp from 'jimp';

/**
 * DCT-based perceptual hash (pHash).
 *
 * Pipeline:
 *   1. decode image, resize to 32x32, convert to greyscale
 *   2. run a 2D Discrete Cosine Transform
 *   3. keep the top-left 8x8 block (the low-frequency coefficients)
 *   4. threshold each coefficient against the median (excluding the DC term)
 *   5. emit a 64-bit hash as a 16-char hex string
 *
 * Two visually identical images (even re-encoded / re-uploaded under a
 * different URL or videoId) produce hashes that are equal or only a few
 * bits apart, which is exactly what the dedup step relies on.
 */

const SIZE = 32; // working resolution before DCT
const LOW = 8; // size of the low-frequency block we keep

// Precomputed 1D DCT-II basis matrix for an N-length signal.
function buildDctMatrix(n: number): number[][] {
  const matrix: number[][] = [];
  for (let k = 0; k < n; k++) {
    const row: number[] = [];
    for (let i = 0; i < n; i++) {
      row.push(Math.cos((Math.PI / n) * (i + 0.5) * k));
    }
    matrix.push(row);
  }
  return matrix;
}

const DCT = buildDctMatrix(SIZE);

function dct1d(vector: number[]): number[] {
  const out = new Array<number>(SIZE).fill(0);
  for (let k = 0; k < SIZE; k++) {
    let sum = 0;
    const basis = DCT[k];
    for (let i = 0; i < SIZE; i++) sum += vector[i] * basis[i];
    out[k] = sum;
  }
  return out;
}

function dct2d(matrix: number[][]): number[][] {
  // transform rows
  const rows = matrix.map((row) => dct1d(row));
  // transform columns
  const out: number[][] = Array.from({ length: SIZE }, () => new Array<number>(SIZE).fill(0));
  const col = new Array<number>(SIZE).fill(0);
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE; r++) col[r] = rows[r][c];
    const transformed = dct1d(col);
    for (let r = 0; r < SIZE; r++) out[r][c] = transformed[r];
  }
  return out;
}

function binaryToHex(bits: string): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Compute the 16-char hex pHash for an encoded image buffer. */
export async function computePHash(buffer: Buffer): Promise<string> {
  const image = await Jimp.read(buffer);
  image.resize(SIZE, SIZE).greyscale();

  const pixels: number[][] = [];
  for (let y = 0; y < SIZE; y++) {
    const row: number[] = [];
    for (let x = 0; x < SIZE; x++) {
      // greyscale => R=G=B, so the red channel is the luminance.
      const idx = (y * SIZE + x) * 4;
      row.push(image.bitmap.data[idx]);
    }
    pixels.push(row);
  }

  const transformed = dct2d(pixels);

  const lows: number[] = [];
  for (let y = 0; y < LOW; y++) {
    for (let x = 0; x < LOW; x++) lows.push(transformed[y][x]);
  }

  // Median of the low-frequency block, excluding the DC term (index 0)
  // which carries overall brightness and would skew the threshold.
  const sorted = lows.slice(1).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let bits = '';
  for (let i = 0; i < lows.length; i++) bits += lows[i] > median ? '1' : '0';

  return binaryToHex(bits);
}

const POPCOUNT: number[] = Array.from({ length: 16 }, (_, n) => {
  let c = 0;
  let v = n;
  while (v) {
    c += v & 1;
    v >>= 1;
  }
  return c;
});

/** Hamming distance between two equal-length hex pHash strings. */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    dist += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return dist;
}
