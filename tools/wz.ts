/** One WZ implementation for the product and analysis CLI; see server/test/wzimg.test.ts. */
import { runWzCommand } from "../server/src/wz/cli.ts";
if (import.meta.main) process.exitCode = runWzCommand(Bun.argv.slice(2));
