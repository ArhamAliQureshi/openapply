// Dev helper: one dry-run autopilot pass with sample preferences, without the web server.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/autopilot-test.mts [dailyLimit]
import { runAutopilot } from "@/lib/apply/autopilot";
import { getProfile, saveProfile } from "@/lib/apply/service";

const limit = Number(process.argv[2] ?? 3);
const profile = await getProfile();
await saveProfile({
  ...profile,
  feed: { ...profile.feed, titles: profile.feed.titles.length ? profile.feed.titles : ["Software Engineer", "Backend Engineer"], locations: profile.feed.locations.length ? profile.feed.locations : ["San Francisco", "United States"] },
  autopilot: { ...profile.autopilot, mode: "dry_run", dailyLimit: limit, minScore: 80 },
});
const t0 = Date.now();
const s = await runAutopilot();
console.log(`Autopilot (${s.mode}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log("Feed:", "error" in (s.feed ?? {}) ? s.feed : { matched: (s.feed as { matched: number }).matched, newJobs: (s.feed as { newJobs: number }).newJobs });
console.log(`considered ${s.considered}, dry runs ${s.dryRuns}, submitted ${s.submitted}, needs you ${s.needsYou}, failed ${s.failed}, skipped ${s.skipped}`);
for (const i of s.items) console.log(`  - ${i.company}: ${i.title} → ${i.outcome}`);
process.exit(0);
