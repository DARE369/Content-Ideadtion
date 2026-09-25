import { PLATFORMS } from "../src/types.js";
import { STALE_AFTER_DAYS, playbook, stalePlaybooks } from "../src/playbooks/index.js";

for (const p of PLATFORMS) playbook(p); // validates every config
const stale = stalePlaybooks();
if (stale.length) {
  for (const s of stale) console.warn(`${s.platform}: reviewed ${s.ageDays} days ago (limit ${STALE_AFTER_DAYS})`);
  process.exit(1);
}
console.log("all playbooks valid and fresh");
