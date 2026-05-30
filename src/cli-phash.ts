import fs from 'fs';
import { computePHash, hammingDistance } from './phash';
import { fetchThumbnail } from './youtube';
import { config } from './config';

/**
 * Proof-of-dedup helper.
 *
 *   npm run phash:demo -- <imageA> <imageB> [imageC ...]
 *
 * Each argument is a local file path or an http(s) URL. The tool prints
 * each image's pHash and the pairwise Hamming distance, plus whether the
 * pair would be treated as a duplicate at the configured PHASH_THRESHOLD.
 *
 * Use it to show that the same thumbnail served from two different URLs
 * (a "re-upload") collapses to the same hash and would NOT be queued twice.
 */
async function load(src: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(src)) return fetchThumbnail(src);
  return fs.readFileSync(src);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: npm run phash:demo -- <imageA> <imageB> [imageC ...]');
    process.exit(1);
  }

  const hashes: { src: string; hash: string }[] = [];
  for (const src of args) {
    const buf = await load(src);
    const hash = await computePHash(buf);
    hashes.push({ src, hash });
    console.log(`pHash ${hash}  <-  ${src}`);
  }

  console.log(`\nthreshold (PHASH_THRESHOLD) = ${config.phashThreshold}\n`);
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      const d = hammingDistance(hashes[i].hash, hashes[j].hash);
      const dup = d <= config.phashThreshold;
      console.log(
        `[${i}] vs [${j}]  distance=${d}  =>  ${dup ? 'DUPLICATE (not queued twice)' : 'distinct'}`
      );
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
