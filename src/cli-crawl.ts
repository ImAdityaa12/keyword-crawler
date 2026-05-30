import { createStore } from './store';
import { runCrawl } from './crawler';

/** Run exactly one crawl pass and print the stats, then exit. */
async function main(): Promise<void> {
  const store = await createStore();
  console.log(`backend: ${store.backend()}`);
  const stats = await runCrawl(store);
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\nqueue size now: ${await store.queueSize()}  (seen: ${await store.seenCount()})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
