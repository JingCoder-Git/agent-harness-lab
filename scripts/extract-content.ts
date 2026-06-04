import * as fs from "fs";
import * as path from "path";
import type { AgentVersion, VersionDiff, DocContent, VersionIndex } from "../src/types/agent-data";
import { VERSION_META, VERSION_ORDER, LEARNING_PATH } from "../src/lib/constants";

const APP_DIR = path.resolve(__dirname, "..");
const EXAMPLES_DIR = path.join(APP_DIR, "examples");
const DOCS_DIR = path.join(APP_DIR, "docs");
const OUT_DIR = path.join(APP_DIR, "src", "data", "generated");

function filenameToVersionId(filename: string): string | null {
  const base = path.basename(filename, path.extname(filename));

  const match = base.match(/^(s\d+[a-c]?)_/);
  if (!match) return null;
  return match[1];
}

function extractClasses(
  lines: string[]
): { name: string; startLine: number; endLine: number }[] {
  const classes: { name: string; startLine: number; endLine: number }[] = [];
  const classPattern = /^class\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(classPattern);
    if (m) {
      const name = m[1];
      const startLine = i + 1;
      // Find end of class: next class/function at indent 0, or EOF
      let endLine = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (
          lines[j].match(/^class\s/) ||
          lines[j].match(/^def\s/) ||
          (lines[j].match(/^\S/) && lines[j].trim() !== "" && !lines[j].startsWith("#") && !lines[j].startsWith("@"))
        ) {
          endLine = j;
          break;
        }
      }
      classes.push({ name, startLine, endLine });
    }
  }
  return classes;
}

function extractFunctions(
  lines: string[]
): { name: string; signature: string; startLine: number }[] {
  const functions: { name: string; signature: string; startLine: number }[] = [];
  const funcPattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\((.*?)\)/;
  const constFuncPattern = /^const\s+(\w+)\s*=\s*(?:async\s*)?\((.*?)\)\s*=>/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(funcPattern) ?? lines[i].match(constFuncPattern);
    if (m) {
      functions.push({
        name: m[1],
        signature: `${m[1]}(${m[2]})`,
        startLine: i + 1,
      });
    }
  }
  return functions;
}

function extractTools(source: string): string[] {
  const tools = new Set<string>();
  const namePattern = /name\s*:\s*["'](\w+)["']/g;
  const registryMatch = source.match(/(?:toolRegistry|tools)\s*[:=]\s*\{([\s\S]*?)\n\}/);

  let m;
  while ((m = namePattern.exec(source)) !== null) {
    tools.add(m[1]);
  }
  if (registryMatch) {
    const keyPattern = /^\s*(\w+)\s*:/gm;
    while ((m = keyPattern.exec(registryMatch[1])) !== null) {
      tools.add(m[1]);
    }
  }
  return Array.from(tools);
}

// Count non-blank, non-comment lines
function countLoc(lines: string[]): number {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  }).length;
}

// Detect locale from subdirectory path
// docs/en/s01-the-agent-loop.md -> "en"
// docs/zh/s01-the-agent-loop.md -> "zh"
// docs/ja/s01-the-agent-loop.md -> "ja"
function detectLocale(relPath: string): "en" | "zh" | "ja" {
  if (relPath.startsWith("zh/") || relPath.startsWith("zh\\")) return "zh";
  if (relPath.startsWith("ja/") || relPath.startsWith("ja\\")) return "ja";
  return "en";
}

// Extract version from doc filename (e.g., "s01-the-agent-loop.md" -> "s01")
function extractDocVersion(filename: string): string | null {
  const m = filename.match(/^(s\d+[a-c]?)-/);
  return m ? m[1] : null;
}

function stripTryIt(content: string): string {
  const headings = [
    "Try it",
    "Try It",
    "试一试",
    "试一下",
    "試してみる",
  ];
  const pattern = new RegExp(
    `\\n##\\s+(?:${headings.join("|")})[\\s\\S]*?(?=\\n##\\s+|$)`,
    "gi"
  );
  return content.replace(pattern, "\n").trimEnd() + "\n";
}

function normalizeLegacyDocs(content: string): string {
  return content
    .replace(/```python[\s\S]*?```/g, [
      "```ts",
      "// TypeScript reference code for this step is available in the Code tab.",
      "// The lesson text keeps the concept; the runnable reference has been rewritten for Node.js.",
      "```",
    ].join("\n"))
    .replace(/\bPython\b/g, "TypeScript")
    .replace(/\.py\b/g, ".ts")
    .replace(/pytest/g, "a test runner")
    .replace(/\bdict\b/g, "object")
    .replace(
      /images\/background-tasks-overview(\.en|\.ja)?\.svg/g,
      "/course-assets/s13_background_tasks/background-tasks-overview$1.svg"
    )
    .replace(
      /images\/cron-scheduler-overview(\.en|\.ja)?\.svg/g,
      "/course-assets/s14_cron_scheduler/cron-scheduler-overview$1.svg"
    );
}

// Main extraction
function main() {
  console.log("Extracting content from examples and docs...");
  console.log(`  App dir: ${APP_DIR}`);
  console.log(`  Examples dir: ${EXAMPLES_DIR}`);
  console.log(`  Docs dir: ${DOCS_DIR}`);

  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.log("  Examples directory not found, using pre-committed generated data.");
    return;
  }

  const exampleFiles = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((f) => f.startsWith("s") && /\.(ts|tsx|js|mjs)$/.test(f));

  console.log(`  Found ${exampleFiles.length} example files`);

  const versions: AgentVersion[] = [];

  for (const filename of exampleFiles) {
    const versionId = filenameToVersionId(filename);
    if (!versionId) {
      console.warn(`  Skipping ${filename}: could not determine version ID`);
      continue;
    }

    const filePath = path.join(EXAMPLES_DIR, filename);
    const source = fs.readFileSync(filePath, "utf-8");
    const lines = source.split("\n");

    const meta = VERSION_META[versionId];
    const classes = extractClasses(lines);
    const functions = extractFunctions(lines);
    const tools = extractTools(source);
    const loc = countLoc(lines);

    versions.push({
      id: versionId,
      filename,
      title: meta?.title ?? versionId,
      subtitle: meta?.subtitle ?? "",
      loc,
      tools,
      newTools: [], // computed after all versions are loaded
      coreAddition: meta?.coreAddition ?? "",
      keyInsight: meta?.keyInsight ?? "",
      classes,
      functions,
      layer: meta?.layer ?? "tools",
      source,
    });
  }

  // Sort versions according to VERSION_ORDER
  const orderMap = new Map(VERSION_ORDER.map((v, i) => [v, i]));
  versions.sort(
    (a, b) => (orderMap.get(a.id as any) ?? 99) - (orderMap.get(b.id as any) ?? 99)
  );

  // 2. Compute newTools for each version
  for (let i = 0; i < versions.length; i++) {
    const prev = i > 0 ? new Set(versions[i - 1].tools) : new Set<string>();
    versions[i].newTools = versions[i].tools.filter((t) => !prev.has(t));
  }

  // 3. Compute diffs between adjacent versions in LEARNING_PATH
  const diffs: VersionDiff[] = [];
  const versionMap = new Map(versions.map((v) => [v.id, v]));

  for (let i = 1; i < LEARNING_PATH.length; i++) {
    const fromId = LEARNING_PATH[i - 1];
    const toId = LEARNING_PATH[i];
    const fromVer = versionMap.get(fromId);
    const toVer = versionMap.get(toId);

    if (!fromVer || !toVer) continue;

    const fromClassNames = new Set(fromVer.classes.map((c) => c.name));
    const fromFuncNames = new Set(fromVer.functions.map((f) => f.name));
    const fromToolNames = new Set(fromVer.tools);

    diffs.push({
      from: fromId,
      to: toId,
      newClasses: toVer.classes
        .map((c) => c.name)
        .filter((n) => !fromClassNames.has(n)),
      newFunctions: toVer.functions
        .map((f) => f.name)
        .filter((n) => !fromFuncNames.has(n)),
      newTools: toVer.tools.filter((t) => !fromToolNames.has(t)),
      locDelta: toVer.loc - fromVer.loc,
    });
  }

  // 4. Read doc files from locale subdirectories (en/, zh/, ja/)
  const docs: DocContent[] = [];

  if (fs.existsSync(DOCS_DIR)) {
    const localeDirs = ["en", "zh", "ja"];
    let totalDocFiles = 0;

    for (const locale of localeDirs) {
      const localeDir = path.join(DOCS_DIR, locale);
      if (!fs.existsSync(localeDir)) continue;

      const docFiles = fs
        .readdirSync(localeDir)
        .filter((f) => f.endsWith(".md"));

      totalDocFiles += docFiles.length;

      for (const filename of docFiles) {
        const version = extractDocVersion(filename);
        if (!version) {
          console.warn(`  Skipping doc ${locale}/${filename}: could not determine version`);
          continue;
        }

        const filePath = path.join(localeDir, filename);
        const content = normalizeLegacyDocs(stripTryIt(fs.readFileSync(filePath, "utf-8")));

        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : filename;

        docs.push({ version, locale: locale as "en" | "zh" | "ja", title, content });
      }
    }

    console.log(`  Found ${totalDocFiles} doc files across ${localeDirs.length} locales`);
  } else {
    console.warn(`  Docs directory not found: ${DOCS_DIR}`);
  }

  // 5. Write output
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const index: VersionIndex = { versions, diffs };
  const indexPath = path.join(OUT_DIR, "versions.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`  Wrote ${indexPath}`);

  const docsPath = path.join(OUT_DIR, "docs.json");
  fs.writeFileSync(docsPath, JSON.stringify(docs, null, 2));
  console.log(`  Wrote ${docsPath}`);

  // Summary
  console.log("\nExtraction complete:");
  console.log(`  ${versions.length} versions`);
  console.log(`  ${diffs.length} diffs`);
  console.log(`  ${docs.length} docs`);
  for (const v of versions) {
    console.log(
      `    ${v.id}: ${v.loc} LOC, ${v.tools.length} tools, ${v.classes.length} classes, ${v.functions.length} functions`
    );
  }
}

main();
