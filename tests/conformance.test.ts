import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MongoryInvalidConditionError, compile } from "../src/index.js";
import { Condition } from "../src/types.js";

interface SpecRecord {
  data: unknown;
  expected: boolean;
}

interface SpecSuite {
  description: string;
  condition: Condition;
  error?: boolean;
  records?: SpecRecord[];
}

const CONFORMANCE_DIRS = [
  "array",
  "compare",
  "composite",
  "errors",
  "existance",
  "field",
  "inclusion",
  "regex",
];

function resolveSpecDir(): string {
  if (process.env.MONGORY_SPEC_DIR) {
    return path.resolve(process.env.MONGORY_SPEC_DIR);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Works from both tests/ and dist-test/tests/
  const candidates = [
    path.resolve(here, "..", "..", "mongory-spec"),
    path.resolve(here, "..", "..", "..", "mongory-spec"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "fixtures"))) {
      return dir;
    }
  }
  throw new Error(
    `mongory-spec fixtures directory not found; set MONGORY_SPEC_DIR (checked: ${candidates.join(", ")})`,
  );
}

const specDir = resolveSpecDir();
let totalFiles = 0;
let totalSuites = 0;
let totalRecords = 0;

for (const dir of CONFORMANCE_DIRS) {
  const dirPath = path.join(specDir, "fixtures", dir);
  assert.ok(fs.existsSync(dirPath), `missing conformance fixture directory: ${dirPath}`);
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".json"))
    .sort();
  assert.ok(files.length > 0, `no JSON fixture files found in ${dirPath}`);

  for (const file of files) {
    totalFiles++;
    const filePath = path.join(dirPath, file);
    const suites = JSON.parse(fs.readFileSync(filePath, "utf8")) as SpecSuite[];
    assert.ok(Array.isArray(suites) && suites.length > 0, `empty suites in ${filePath}`);

    for (const suite of suites) {
      totalSuites++;
      test(`spec:${dir}/${file}:${suite.description}`, () => {
        if (suite.error) {
          assert.throws(
            () => compile(suite.condition),
            MongoryInvalidConditionError,
            `expected error for condition ${JSON.stringify(suite.condition)}`,
          );
          return;
        }
        const matcher = compile(suite.condition);
        const records = suite.records ?? [];
        assert.ok(records.length > 0, `expected non-empty records for ${suite.description}`);
        for (const rec of records) {
          totalRecords++;
          const got = matcher.match(rec.data);
          assert.equal(
            got,
            rec.expected,
            `match(${JSON.stringify(rec.data)}) = ${got}, want ${rec.expected} for ${JSON.stringify(suite.condition)}`,
          );
          const traced = matcher.trace(rec.data);
          assert.equal(
            traced.matched,
            rec.expected,
            `trace(${JSON.stringify(rec.data)}).matched = ${traced.matched}, want ${rec.expected}`,
          );
        }
      });
    }
  }
}

test("spec:inventory non-empty", () => {
  assert.ok(totalFiles >= 17, `expected at least 17 fixture files, got ${totalFiles}`);
  assert.ok(totalSuites >= 102, `expected at least 102 suites, got ${totalSuites}`);
  assert.ok(totalRecords >= 401, `expected at least 401 record assertions, got ${totalRecords}`);
});
