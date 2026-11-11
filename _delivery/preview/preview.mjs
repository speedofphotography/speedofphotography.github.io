// Local preview of client photo delivery: the real gallery page and functions, with a pretend R2 bucket
// filled with sample galleries made from portfolio photos. Nothing is uploaded anywhere.
//
//   node _delivery/preview/preview.mjs            start on http://localhost:8788
//   node _delivery/preview/preview.mjs --reseed   rebuild the sample galleries first
//
// Needs Node.js. The first run downloads Cloudflare's dev tool (wrangler) through npx.
// The page header and footer are copied from the live home page so it looks like the real site;
// gallery files (delivery.js/.css, g/, functions/) always come from this folder.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
// Kept in the temp folder: the dev tool's storage paths are deep, and Windows refuses paths over 260 characters.
const work = path.join(os.tmpdir(), "sop-delivery-preview");
const site = path.join(work, "site");
const state = path.join(work, "state");
const PORT = Number(process.env.PORT || 8788);
const LIVE = "https://speedofphotography.com";
const WRANGLER = "wrangler@4";
const BUCKET = "sop-deliveries";

const SAMPLES = {
  "demo-gt3-k7q2m9": {
    meta: {
      title: "Demo: GT3 RS canyon run",
      client: "Sample client",
      date: "2026-11-08",
      message: "Thanks for a great shoot! Here are your finished edits.\nLet me know if you'd like any changes.",
      expires: "2099-12-31",
    },
    photos: [
      "porsche-gt3-rs-canyon.jpg", "huracan-above.jpg", "laferrari-doors-up.jpg", "porsche-993-turbo.jpg",
      "aventador-night.jpg", "emira-track-rolling.jpg", "gt4-garage.jpg", "lamborghini-interior.jpg",
      "porsche-crest.jpg", "mclaren-senna-warehouse.jpg", "salt-flats-mustang.jpg", "carrera-gt-garage.jpg",
    ],
    extra: { "Usage rights.txt": "Sample non-photo file: shows as a download tile.\n" },
  },
  "demo-plain-x4m2pq": { meta: null, photos: ["miata-salt-flats.jpg", "evo-x-salt-flats.jpg", "porsche-992-gt3.jpg"] },
  "demo-expired-r8t3vw": { meta: { title: "Old gallery", expires: "2024-01-31" }, photos: ["gt4-garage.jpg"] },
};

const npx = (args, opts = {}) => spawnSync("npx", ["--yes", WRANGLER, ...args], { cwd: work, shell: true, encoding: "utf8", ...opts });

// The live home page with this branch's "client gallery" box added at the bottom, and this branch's
// style.css and script.js. Everything else (photos, fonts) still loads from the live site.
function homePage(live) {
  if (!live.includes("</main>")) return "";
  const src = fs.readFileSync(path.join(repo, "index.html"), "utf8");
  const section = (src.match(/\n\s*\{%-? assign cg[\s\S]*?id="client-gallery"[\s\S]*?<\/section>\n/) || [""])[0];
  const data = {};
  for (const m of fs.readFileSync(path.join(repo, "_data", "client_gallery.yml"), "utf8").matchAll(/^(\w+):\s*(.*)$/gm)) {
    data[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const html = section.replace(/\{%-?[^%]*-?%\}/g, "")
    .replace(/\{\{\s*cg\.(\w+)\s*\|\s*default:\s*"([^"]*)"[^}]*\}\}/g, (_, k, d) => esc(data[k] || d));
  return live
    .replace(/(src|href)="\/(?!\/)/g, `$1="${LIVE}/`)
    .replace(new RegExp(`(href|src)="${LIVE}/(style\\.css|script\\.js)[^"]*"`, "g"), '$1="/$2"')
    .replace("</main>", html + "  </main>");
}

async function buildSite() {
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(path.join(site, "g"), { recursive: true });
  for (const f of ["style.css", "script.js", "delivery.css", "delivery.js", "favicon.ico", "favicon-32.png", "apple-touch-icon.png"]) {
    if (fs.existsSync(path.join(repo, f))) fs.copyFileSync(path.join(repo, f), path.join(site, f));
  }
  fs.copyFileSync(path.join(repo, "g", "sw.js"), path.join(site, "g", "sw.js"));
  for (const d of ["functions", "_functions_lib"]) {
    fs.rmSync(path.join(work, d), { recursive: true, force: true });
    fs.cpSync(path.join(repo, d), path.join(work, d), { recursive: true });
  }

  // The gallery page body, with its two Liquid bits filled in.
  const src = fs.readFileSync(path.join(repo, "g", "index.html"), "utf8");
  const content = fs.readFileSync(path.join(repo, "_data", "content.yml"), "utf8");
  const email = (content.match(/^\s+email:\s*["']?([^"'\s]+@[^"'\s]+)/m) || [])[1] || "";
  const body = src.replace(/^---[\s\S]*?\n---\r?\n/, "")
    .replace(/\{%-?[^%]*-?%\}/g, "")
    .replace(/\{\{\s*c\.contact\.email[^}]*\}\}/g, email);

  let home = "";
  try { home = await (await fetch(LIVE + "/")).text(); } catch { /* offline */ }
  const pick = (re) => (home.match(re) || [""])[0];
  const header = pick(/<header class="site-header">[\s\S]*?<\/header>/);
  const footer = pick(/<footer class="site-footer">[\s\S]*?<\/footer>/);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Client gallery | Speed Of Photography</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,700;1,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/delivery.css">
</head>
<body>
  ${header.replace(/(src|href)="\/(?!\/)(?!g\/)/g, `$1="${LIVE}/`)}
  <main id="top">
${body}
  </main>
  ${footer.replace(/(src|href)="\/(?!\/)/g, `$1="${LIVE}/`) || '<footer class="site-footer"><div class="footer-inner"><p class="copyright">&copy; <span id="year"></span></p></div></footer>'}
  <script src="/script.js"></script>
  <script src="/delivery.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(site, "g", "index.html"), html);
  fs.writeFileSync(path.join(site, "index.html"), homePage(home) || '<!doctype html><meta http-equiv="refresh" content="0; url=/g/">');
  fs.writeFileSync(path.join(work, "wrangler.toml"), [
    'name = "sop-delivery-preview"',
    'pages_build_output_dir = "./site"',
    'compatibility_date = "2026-11-09"',
    "[[r2_buckets]]",
    'binding = "DELIVERY"',
    `bucket_name = "${BUCKET}"`,
    "",
  ].join("\n"));
  if (!header) console.log("(Couldn't reach the live site, so the preview has no header or footer.)");
}

function seed() {
  console.log("Filling the pretend R2 bucket with sample galleries (first run only, about a minute)...");
  fs.rmSync(state, { recursive: true, force: true });
  const tmp = path.join(work, "seed-tmp");
  fs.mkdirSync(tmp, { recursive: true });
  const put = (key, file) => {
    const r = npx(["r2", "object", "put", `"${BUCKET}/${key}"`, "--file", `"${file}"`, "--local", "--persist-to", "state"]);
    if (r.status !== 0) throw new Error(`Couldn't add ${key}:\n${r.stdout}\n${r.stderr}`);
    process.stdout.write(".");
  };
  for (const [code, g] of Object.entries(SAMPLES)) {
    g.photos.forEach((p, i) => put(`${code}/IMG_${String(i + 1).padStart(4, "0")}.jpg`, path.join(repo, "images", p)));
    for (const [name, text] of Object.entries(g.extra || {})) {
      const f = path.join(tmp, name);
      fs.writeFileSync(f, text);
      put(`${code}/${name}`, f);
    }
    if (g.meta) {
      const f = path.join(tmp, `${code}.json`);
      fs.writeFileSync(f, JSON.stringify(g.meta, null, 2));
      put(`${code}/gallery.json`, f);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(state, "seeded"), new Date().toISOString());
  console.log(" done");
}

fs.mkdirSync(work, { recursive: true });
await buildSite();
if (process.argv.includes("--reseed") || !fs.existsSync(path.join(state, "seeded"))) seed();

console.log(`\nClient gallery preview: http://localhost:${PORT}/g/`);
for (const code of Object.keys(SAMPLES)) console.log(`  http://localhost:${PORT}/g/${code}/`);
console.log("Press Ctrl+C to stop.\n");
const dev = spawn("npx", ["--yes", WRANGLER, "pages", "dev", "--port", String(PORT), "--persist-to", "state", "--ip", "127.0.0.1"], {
  cwd: work, shell: true, stdio: "inherit",
});
dev.on("exit", (code) => process.exit(code ?? 0));
