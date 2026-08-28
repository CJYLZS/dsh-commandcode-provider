// Standalone end-to-end verification of the data pipeline against live sources.
// Run: node_modules stubs for @deepseek-ai/* then `node verify_convert.mjs`.
import { fetchModelList, fetchCatalog, buildEntries, buildRoutePatch, providerKey } from "./lib/index.js";

const apiList = await fetchModelList("https://api.commandcode.ai/provider/v1/models");
const catalog = await fetchCatalog("https://commandcode.ai/docs/plans/goat");
console.log("API models:", apiList.length, "| catalog entries:", catalog.length);

// Official totals (cumulative by minPlanName): goat 43 / pro 56 / max 61.
// openai/anthropic split: goat 43+0, pro 53+3 (3 Claude at Pro), max 54+7.
const EXPECT = { goat: [43, 0], pro: [53, 3], max: [54, 7] };
for (const plan of ["goat", "pro", "max"]) {
  const byRoute = buildEntries({ apiList, catalog, plan, extraIds: [] });
  console.log(`\n=== plan=${plan} ===`);
  for (const route of ["openai", "anthropic"]) {
    const entries = byRoute[route];
    console.log(`route ${route}: ${entries.length} models (expect ${EXPECT[plan][route === "anthropic" ? 1 : 0]}) -> key ${providerKey(plan, route)}`);
    if (route === "openai" && entries.length) {
      const e0 = entries[0], last = entries[entries.length - 1];
      console.log("  sample:", JSON.stringify(e0), "\n  last  :", JSON.stringify(last));
      const reasonFalse = entries.filter((e) => e.reasoningEfforts === false).length;
      const vision = entries.filter((e) => e.input?.includes("image")).length;
      console.log(`  reasoningEfforts:false=${reasonFalse}  vision=${vision}  withName=${entries.filter((e) => e.name).length}`);
    }
  }
}

// Patch shapes: goat provider + max anthropic provider + extraIds.
const byRouteGoat = buildEntries({ apiList, catalog, plan: "goat", extraIds: ["custom/private-model"] });
const oa = buildRoutePatch({ key: providerKey("goat", "openai"), route: "openai", entries: byRouteGoat.openai }, {});
console.log("\n=== goat openai patch ===");
console.log(JSON.stringify({ ...oa.patch, models: oa.patch.models.slice(0, 2).concat(["…total " + oa.patch.models.length]) }, null, 1));
const byRouteMax = buildEntries({ apiList, catalog, plan: "max", extraIds: [] });
const an = buildRoutePatch({ key: providerKey("max", "anthropic"), route: "anthropic", entries: byRouteMax.anthropic }, {});
console.log("\n=== max anthropic patch ===");
console.log(JSON.stringify({ ...an.patch, models: an.patch.models.slice(0, 2).concat(["…total " + an.patch.models.length]) }, null, 1));