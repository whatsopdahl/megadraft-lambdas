import { readFileSync, writeFileSync } from "node:fs";

// Converts the RK/PLAYER NAME CSVs in data/ into name->rank JSON lookups
// under src/data/, so syncEspnPlayers can import them directly - the lambda
// deploy zip only contains the built .mjs, not the data/ directory, so the
// rankings must be baked into the bundle at build time rather than read
// from disk at runtime. Re-run this whenever the source CSVs are updated.
function parseCsv(path: string): Record<string, number> {
  const lines = readFileSync(path, "utf-8").split("\n").filter((line) => line.trim().length > 0);
  const rankings: Record<string, number> = {};
  for (const line of lines.slice(1)) {
    const [rank, name] = line.split(",");
    if (!rank || !name) {
      continue;
    }
    const key = name.trim().toLowerCase();
    // First occurrence wins - a handful of names collide across different
    // real players and the CSV has no other identifying info to split on.
    if (!(key in rankings)) {
      rankings[key] = Number(rank.trim());
    }
  }
  return rankings;
}

const files: { csv: string; json: string }[] = [
  { csv: "data/NBA Rankings.csv", json: "src/data/nbaOverallRankings.json" },
  { csv: "data/NFL Rankings.csv", json: "src/data/nflOverallRankings.json" },
];

for (const { csv, json } of files) {
  const rankings = parseCsv(csv);
  writeFileSync(json, `${JSON.stringify(rankings, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(rankings).length} rankings to ${json}`);
}
