import { runPending } from "./pending";
import { seedDemoLeads } from "./seed-demo";

const command = process.argv[2];
try {
  if (command === "run-pending") await runPending();
  else if (command === "seed-demo") await seedDemoLeads();
  else throw new Error(`Unknown command "${command}". Use run-pending or seed-demo.`);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
