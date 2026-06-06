#!/usr/bin/env node
/**
 * chromectl — entrypoint shim
 *
 * chromectl requires Bun to run. This shim checks for Bun and either
 * re-invokes the CLI via Bun or exits with a clear error message.
 */

if (typeof Bun !== "undefined") {
  // Already running under Bun — import the real CLI
  import("../src/cli.ts")
    .then((m) => m.main(process.argv.slice(2)))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  console.error(`chromectl requires Bun to run.`);
  console.error(`Install Bun: https://bun.sh`);
  console.error(`Then run: bun install -g chromectl`);
  process.exit(1);
}
