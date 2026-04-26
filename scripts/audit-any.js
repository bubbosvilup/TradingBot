#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "tests", "scripts"];
const SUPPORTED_EXTENSIONS = new Set([".ts", ".js"]);
const HOTSPOT_THRESHOLD = 20;
const WATCHLIST_THRESHOLD = 10;
const TOP_FILE_LIMIT = 10;

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function classify(relativePath, lineText) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const text = lineText.toLowerCase();

  if (normalizedPath.startsWith("tests/") || normalizedPath.startsWith("scripts/")) {
    return "test/support";
  }

  if (
    text.includes("payload")
    || text.includes("event")
    || text.includes("websocket")
    || text.includes("ws")
    || text.includes("ticker")
    || text.includes("kline")
    || text.includes("exchange")
    || text.includes("request")
    || text.includes("response")
  ) {
    return "raw external payload";
  }

  if (
    text.includes("telemetry")
    || text.includes("diagnostic")
    || text.includes("metadata")
    || text.includes("logger")
    || text.includes("report")
  ) {
    return "telemetry/payload";
  }

  if (
    text.includes("state")
    || text.includes("context")
    || text.includes("decision")
    || text.includes("position")
    || text.includes("trade")
    || text.includes("store")
    || text.includes("bot")
    || text.includes("strategy")
  ) {
    return "internal business state";
  }

  return "unknown";
}

function getLine(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function lineText(source, lineNumber) {
  return source.split(/\r?\n/)[lineNumber - 1] || "";
}

function countLines(source) {
  if (source.length === 0) {
    return 0;
  }
  return source.split(/\r?\n/).length;
}

function riskLabel(count) {
  if (count > HOTSPOT_THRESHOLD) {
    return "hotspot";
  }
  if (count >= WATCHLIST_THRESHOLD) {
    return "watchlist";
  }
  return "low";
}

function formatDensity(count, lineCount) {
  if (!lineCount) {
    return "n/a";
  }
  return ((count / lineCount) * 100).toFixed(2);
}

function collectAnyUsages(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const relativePath = path.relative(ROOT, filePath);
  const usages = [];

  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const line = getLine(sourceFile, node.getStart(sourceFile));
      const text = lineText(source, line);
      usages.push({
        line,
        category: classify(relativePath, text),
        text: text.trim()
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usages;
}

const files = TARGET_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))).sort();
const byFile = [];
const byCategory = new Map();

for (const file of files) {
  const usages = collectAnyUsages(file);
  if (usages.length === 0) {
    continue;
  }

  const relativePath = path.relative(ROOT, file).replace(/\\/g, "/");
  const categories = new Map();
  for (const usage of usages) {
    categories.set(usage.category, (categories.get(usage.category) || 0) + 1);
    byCategory.set(usage.category, (byCategory.get(usage.category) || 0) + 1);
  }

  byFile.push({
    file: relativePath,
    count: usages.length,
    categories: Object.fromEntries([...categories.entries()].sort()),
    lineCount: countLines(fs.readFileSync(file, "utf8")),
    lines: usages.map((usage) => usage.line)
  });
}

byFile.sort((left, right) => right.count - left.count || left.file.localeCompare(right.file));

const total = byFile.reduce((sum, entry) => sum + entry.count, 0);
const byDensity = [...byFile].sort((left, right) => {
  const leftDensity = left.lineCount ? left.count / left.lineCount : -1;
  const rightDensity = right.lineCount ? right.count / right.lineCount : -1;
  return rightDensity - leftDensity || right.count - left.count || left.file.localeCompare(right.file);
});
const hotspots = byFile.filter((entry) => entry.count > HOTSPOT_THRESHOLD);

console.log(`Explicit any total: ${total}`);
console.log("");
console.log(`Hotspot threshold: >${HOTSPOT_THRESHOLD} explicit any in one file`);
console.log(`Risk labels: hotspot >${HOTSPOT_THRESHOLD}, watchlist ${WATCHLIST_THRESHOLD}-${HOTSPOT_THRESHOLD}, low <${WATCHLIST_THRESHOLD}`);
console.log("");
console.log("By category:");
for (const [category, count] of [...byCategory.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
  console.log(`- ${category}: ${count}`);
}

console.log("");
console.log(`Top files by any count (top ${Math.min(TOP_FILE_LIMIT, byFile.length)}):`);
for (const entry of byFile.slice(0, TOP_FILE_LIMIT)) {
  console.log(`- ${entry.file}: ${entry.count} any, ${entry.lineCount} lines, density ${formatDensity(entry.count, entry.lineCount)} any/100 lines, risk=${riskLabel(entry.count)}`);
}

console.log("");
console.log(`Top files by any density (top ${Math.min(TOP_FILE_LIMIT, byDensity.length)}):`);
for (const entry of byDensity.slice(0, TOP_FILE_LIMIT)) {
  console.log(`- ${entry.file}: density ${formatDensity(entry.count, entry.lineCount)} any/100 lines, ${entry.count} any, ${entry.lineCount} lines, risk=${riskLabel(entry.count)}`);
}

console.log("");
console.log(`Files above hotspot threshold (> ${HOTSPOT_THRESHOLD} any):`);
if (hotspots.length === 0) {
  console.log("- none");
} else {
  for (const entry of hotspots) {
    console.log(`- ${entry.file}: ${entry.count} any, density ${formatDensity(entry.count, entry.lineCount)} any/100 lines`);
  }
}

console.log("");
console.log("Current top offenders:");
for (const entry of byFile.slice(0, 5)) {
  console.log(`- ${entry.file}: ${entry.count} any, risk=${riskLabel(entry.count)}`);
}

console.log("");
console.log("All files by any count:");
for (const entry of byFile) {
  const categories = Object.entries(entry.categories)
    .map(([category, count]) => `${category}=${count}`)
    .join(", ");
  console.log(`- ${entry.file}: ${entry.count} any, ${entry.lineCount} lines, density ${formatDensity(entry.count, entry.lineCount)} any/100 lines, risk=${riskLabel(entry.count)} (${categories})`);
}
