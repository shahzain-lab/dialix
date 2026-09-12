import { readFileSync, writeFileSync } from "node:fs";

const packages = [
  { file: "packages/shared/package.json", extra: {} },
  { file: "packages/db/package.json", extra: { "./schema": "./dist/schema.js" } },
];

for (const { file, extra } of packages) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.main = "./dist/index.js";
  pkg.types = "./dist/index.d.ts";
  pkg.exports = { ".": "./dist/index.js", ...extra };
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
