// Post-bunup tweak: mark the compiled CLI executable.
//
// bunup writes dist/ayjnt.js with regular file perms (0644). The shebang
// is in place but the OS won't exec the file unless the executable bit
// is set, so `node_modules/.bin/ayjnt` symlinks fail with EACCES until
// we chmod it. Doing this in a Bun script (rather than `chmod +x`)
// keeps the build cross-platform — `chmod` doesn't exist on Windows.

import { chmodSync, existsSync } from "node:fs";
import * as path from "node:path";

const cli = path.resolve(import.meta.dir, "..", "dist", "ayjnt.js");

if (!existsSync(cli)) {
  console.error(`postbuild: expected ${cli} to exist after bunup`);
  process.exit(1);
}

// 0o755 = rwxr-xr-x. Owner can write, everyone can execute.
chmodSync(cli, 0o755);
console.log(`postbuild: chmod 755 dist/ayjnt.js`);
