const core = ["lint", "type-check", "unit-test", "api-v2-unit-test", "security-audit"];
const browser = ["build", "build-api-v2", "build-atoms", "setup-db", "integration-test", "e2e", "e2e-api-v2", "e2e-embed", "e2e-embed-react", "e2e-app-store"];

function requiredFailures(needs) {
  const failures = ["trust-check", "prepare"].filter((job) => needs[job]?.result !== "success");
  if (needs["trust-check"]?.outputs?.["is-trusted"] !== "true") failures.push("untrusted-source");
  const flags = needs.prepare?.outputs ?? {};
  for (const flag of ["has-files-requiring-all-checks", "has-prisma-changes", "run-e2e"])
    if (!["true", "false"].includes(flags[flag])) failures.push(`missing-or-invalid-${flag}`);
  const required = flags["has-files-requiring-all-checks"] === "true" ? [...core] : [];
  if (flags["has-prisma-changes"] === "true") required.push("check-prisma-migrations");
  if (flags["has-files-requiring-all-checks"] === "true" && flags["run-e2e"] === "true") required.push(...browser);
  return [...failures, ...required.filter((job) => needs[job]?.result !== "success")];
}
module.exports = { requiredFailures, core, browser };
if (require.main === module) {
  const failures = requiredFailures(JSON.parse(process.env.NEEDS_JSON));
  if (failures.length) {
    console.error(`Required checks failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}
