#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && path.extname(entry.name) === ".ts") {
      files.push(fullPath);
    }
  }
  return files;
}

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.js")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function readImports(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const imports = [];

  function record(specifier, node) {
    const resolved = resolveImport(filePath, specifier);
    if (!resolved) {
      return;
    }

    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    imports.push({
      specifier,
      target: toRepoPath(resolved),
      line
    });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      record(node.moduleSpecifier.text, node);
    }

    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.Identifier
      && node.expression.getText(sourceFile) === "require"
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      record(node.arguments[0].text, node);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function boundaryLabel(from, target) {
  if (from.startsWith("src/types/") && target.startsWith("src/core/")) {
    return "src/types importing src/core";
  }

  if (from.startsWith("src/utils/") && target.startsWith("src/core/")) {
    return "src/utils importing src/core";
  }

  if (
    from.startsWith("src/strategies/")
    && (
      target.startsWith("src/roles/")
      || target.startsWith("src/core/")
      || target.startsWith("src/streams/")
      || target.startsWith("src/bots/")
    )
  ) {
    return "src/strategies importing runtime layer";
  }

  if (
    from.startsWith("src/roles/")
    && (target.startsWith("src/streams/") || target.startsWith("src/bots/"))
  ) {
    return "src/roles importing streams/bots";
  }

  if (from.startsWith("src/") && target.startsWith("legacy/") && from !== "src/engines/backtestEngine.ts") {
    return "runtime importing legacy outside backtestEngine";
  }

  if (from === "src/core/botManager.ts" && target === "src/bots/tradingBot.ts") {
    return "src/core/botManager.ts importing concrete TradingBot";
  }

  if (from === "src/core/stateStore.ts" && target === "src/core/configLoader.ts") {
    return "StateStore importing ConfigLoader constants";
  }

  return null;
}

function findCycles(graph) {
  const cycles = new Set();
  const nodes = [...graph.keys()].sort();

  function canonicalize(cycle) {
    const withoutRepeat = cycle.slice(0, -1);
    const rotations = withoutRepeat.map((_, index) => withoutRepeat.slice(index).concat(withoutRepeat.slice(0, index)));
    rotations.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
    return rotations[0].concat(rotations[0][0]).join(" > ");
  }

  function dfs(start, current, stack, seen) {
    for (const next of graph.get(current) || []) {
      if (next === start) {
        cycles.add(canonicalize(stack.concat(next)));
        continue;
      }

      if (seen.has(next) || !graph.has(next)) {
        continue;
      }

      seen.add(next);
      dfs(start, next, stack.concat(next), seen);
      seen.delete(next);
    }
  }

  for (const node of nodes) {
    dfs(node, node, [node], new Set([node]));
  }

  return [...cycles].sort();
}

const files = walk(SRC_ROOT).sort();
const graph = new Map();
const boundaryViolations = [];
const stats = [];

for (const file of files) {
  const repoPath = toRepoPath(file);
  const source = fs.readFileSync(file, "utf8");
  const imports = readImports(file);
  graph.set(repoPath, imports.map((entry) => entry.target).filter((target) => target.startsWith("src/")));

  for (const entry of imports) {
    const label = boundaryLabel(repoPath, entry.target);
    if (label) {
      boundaryViolations.push({
        label,
        from: repoPath,
        target: entry.target,
        line: entry.line
      });
    }
  }

  stats.push({
    file: repoPath,
    bytes: Buffer.byteLength(source),
    lines: source.split(/\r?\n/).length,
    imports: imports.length
  });
}

stats.sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));
const cycles = findCycles(graph);

console.log("Architecture baseline");
console.log("");
console.log(`Source files: ${files.length}`);
console.log(`Import cycles detected by local parser: ${cycles.length}`);
for (const cycle of cycles) {
  console.log(`- ${cycle}`);
}

console.log("");
console.log(`Boundary findings: ${boundaryViolations.length}`);
for (const finding of boundaryViolations) {
  console.log(`- ${finding.label}: ${finding.from}:${finding.line} -> ${finding.target}`);
}

console.log("");
console.log("Largest files by line count:");
for (const entry of stats.slice(0, 15)) {
  console.log(`- ${entry.file}: ${entry.lines} lines, ${entry.bytes} bytes, ${entry.imports} imports`);
}

console.log("");
console.log("ExecutionEngine/UserStream shared mutation ownership note:");
console.log("- src/engines/executionEngine.ts publishes opened/closed order updates through UserStream.");
console.log("- src/streams/userStream.ts normalizes remote and local user events and republishes to subscribers.");
console.log("- src/core/orchestrator.ts wires UserStream subscriber mutations back into StateStore.");
