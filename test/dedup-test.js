// Proof that the perceptual hash dedups a re-upload.
//
// Uses REAL data: it runs one live search for the configured KEYWORD, takes two
// distinct thumbnails from the results, and shows that
//   - the SAME thumbnail re-encoded as JPEG / resized (i.e. a re-upload under a
//     different URL & videoId) stays within PHASH_THRESHOLD  -> caught as dup
//   - a genuinely DIFFERENT thumbnail is far away                -> kept distinct
//
// Requires YOUTUBE_API_KEY in .env (same key the service uses). Runs against the
// compiled dist/.  Usage:  npm run test:dedup
require('dotenv').config();
const Jimp = require('jimp');
const { computePHash, hammingDistance } = require('../dist/phash');
const { searchVideos, fetchThumbnail } = require('../dist/youtube');

async function main() {
  const threshold = Number(process.env.PHASH_THRESHOLD || 5);
  const keyword = process.env.KEYWORD || 'lofi hip hop';

  if (!process.env.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY is not set — add it to .env to run this proof.');
    console.log('RESULT=FAIL');
    process.exit(1);
  }

  // Grab a couple of distinct thumbnails from a live search.
  const { items } = await searchVideos(keyword, 1, 10);
  const withThumbs = items.filter((i) => i.thumbnailUrl);
  if (withThumbs.length < 2) {
    console.error('not enough results with thumbnails to run the proof');
    console.log('RESULT=FAIL');
    process.exit(1);
  }
  const original = withThumbs[0];
  const other = withThumbs.find((i) => i.videoId !== original.videoId);

  const origBuf = await fetchThumbnail(original.thumbnailUrl);
  const otherBuf = await fetchThumbnail(other.thumbnailUrl);
  const img = await Jimp.read(origBuf);

  // Simulate a re-upload of `original`: same picture, re-encoded + resized, so
  // the bytes / URL / videoId all differ but the content is identical.
  const reuploadBuf = await img.clone().resize(320, 180).quality(72).getBufferAsync(Jimp.MIME_JPEG);

  const hOriginal = await computePHash(origBuf);
  const hReupload = await computePHash(reuploadBuf);
  const hDifferent = await computePHash(otherBuf);

  const dReupload = hammingDistance(hOriginal, hReupload);
  const dDifferent = hammingDistance(hOriginal, hDifferent);

  console.log(`keyword          : "${keyword}"`);
  console.log(`original  (${original.videoId})  pHash: ${hOriginal}`);
  console.log(`re-upload (re-encoded+resized) pHash: ${hReupload}  distance = ${dReupload}`);
  console.log(`different (${other.videoId})  pHash: ${hDifferent}  distance = ${dDifferent}`);
  console.log(`threshold        : ${threshold}`);

  const reuploadCaught = dReupload <= threshold;
  const differentKept = dDifferent > threshold;
  console.log(`re-upload caught as duplicate : ${reuploadCaught}`);
  console.log(`different image kept distinct  : ${differentKept}`);

  if (reuploadCaught && differentKept) {
    console.log('RESULT=PASS');
    process.exit(0);
  }
  console.log('RESULT=FAIL');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  console.log('RESULT=FAIL');
  process.exit(1);
});
