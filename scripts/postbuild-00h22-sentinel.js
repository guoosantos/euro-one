import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const clientRoot = path.join(repoRoot, "client");
const distRoot = path.join(clientRoot, "dist");
const assetsRoot = path.join(distRoot, "assets");
const sentinelRouteBaseName = "Sentinel-00h22.js";
const sentinelAppBaseName = "sentinel-00h22-app.js";
const sentinelHtmlBaseName = "sentinel-00h22.html";

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, contents) {
  fs.writeFileSync(filePath, contents);
}

function findAssetByPattern(pattern) {
  return fs.readdirSync(assetsRoot).find((entry) => pattern.test(entry)) || null;
}

function writeSentinelRouteChunk(targetPath, mainAsset) {
  const source = `import { j as runtime } from "./${mainAsset}";

const { jsx } = runtime;
const frameSrc = "/assets/${sentinelHtmlBaseName}";
const RESIZE_EVENT_TYPE = "euro-one:sentinel:resize";
const OPEN_CHAT_EVENT_TYPE = "euro-one:sentinel:open-chat";
const FRAME_ID = "sentinel-00h22-frame";

if (typeof window !== "undefined" && !window.__euroOneSentinelBridgeBound) {
  window.__euroOneSentinelBridgeBound = true;
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const frame = document.getElementById(FRAME_ID);
    if (event.data?.type === RESIZE_EVENT_TYPE && frame) {
      const nextHeight = Number(event.data?.height);
      if (Number.isFinite(nextHeight) && nextHeight > 0) {
        frame.style.height = Math.max(720, Math.min(nextHeight, 5000)) + "px";
      }
    }
    if (event.data?.type === OPEN_CHAT_EVENT_TYPE) {
      window.dispatchEvent(new CustomEvent("euro-one:open-operational-ai"));
    }
  });
}

export default function Sentinel00h22Frame() {
  return jsx("div", {
    className: "overflow-hidden rounded-[28px] border border-white/10 bg-[#07111a]/60 shadow-2xl",
    children: jsx("iframe", {
      id: FRAME_ID,
      src: frameSrc,
      title: "SENTINEL",
      loading: "lazy",
      style: {
        width: "100%",
        height: "960px",
        minHeight: "calc(100vh - 12rem)",
        border: "0",
        display: "block",
        background: "transparent",
      },
    }),
  });
}
`;

  write(targetPath, source);
}

function buildStandaloneSentinelApp(appJsPath, appHtmlPath, mainCssAsset) {
  const entryPath = path.join(clientRoot, "src/features/ai/SentinelStandaloneApp.jsx");
  execFileSync(
    "npx",
    [
      "esbuild",
      entryPath,
      "--bundle",
      "--format=esm",
      "--platform=browser",
      "--target=es2020",
      "--minify",
      "--jsx=automatic",
      "--loader:.js=jsx",
      "--loader:.jsx=jsx",
      `--outfile=${appJsPath}`,
    ],
    {
      cwd: clientRoot,
      stdio: "inherit",
    },
  );

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SENTINEL</title>
  <link rel="stylesheet" crossorigin href="/assets/${mainCssAsset}">
  <style>
    :root {
      color-scheme: dark;
    }

    * {
      box-sizing: border-box;
    }

    html, body, #root {
      min-height: 100%;
    }

    body {
      margin: 0;
      overflow-y: auto;
      background:
        radial-gradient(circle at top, rgba(34, 211, 238, 0.14), transparent 38%),
        linear-gradient(180deg, #07111a 0%, #04090f 100%);
      color: #f5f7fa;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .sentinel-app {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    @media (max-width: 840px) {
      .sentinel-app {
        padding: 16px;
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" crossorigin src="/assets/${path.basename(appJsPath)}"></script>
</body>
</html>
`;

  write(appHtmlPath, html);
}

function patchMainBundle(mainPath) {
  let source = read(mainPath);

  if (!source.includes(`import("./${sentinelRouteBaseName}")`)) {
    const replaced = source.replace(
      ',dF=[{path:"/dashboard"',
      `,Sentinel00h22=ye.lazy(()=>import("./${sentinelRouteBaseName}")),dF=[{path:"/dashboard"`,
    );
    if (replaced !== source) {
      source = replaced;
    }
  }

  const sentinelRoutePattern = /\{path:"\/sentinel",element:[^,]+,title:"SENTINEL",requireTenant:!0,permission:\{menuKey:"primary",pageKey:"monitoring"\}\}/;
  if (sentinelRoutePattern.test(source)) {
    source = source.replace(
      sentinelRoutePattern,
      '{path:"/sentinel",element:Sentinel00h22,title:"SENTINEL",requireTenant:!0,permission:{menuKey:"primary",pageKey:"monitoring"}}',
    );
  } else if (!source.includes('path:"/sentinel"')) {
    const replaced = source.replace(
      '{path:"/home",element:JL,title:"Visão geral",hideTitle:!0,requireTenant:!0,permission:{menuKey:"primary",pageKey:"home"}},{path:"/monitoring",element:t4,title:"Monitoramento",requireTenant:!0,permission:{menuKey:"primary",pageKey:"monitoring"}}',
      '{path:"/home",element:JL,title:"Visão geral",hideTitle:!0,requireTenant:!0,permission:{menuKey:"primary",pageKey:"home"}},{path:"/sentinel",element:Sentinel00h22,title:"SENTINEL",requireTenant:!0,permission:{menuKey:"primary",pageKey:"monitoring"}},{path:"/monitoring",element:t4,title:"Monitoramento",requireTenant:!0,permission:{menuKey:"primary",pageKey:"monitoring"}}',
    );
    if (replaced !== source) {
      source = replaced;
    }
  }

  if (!source.includes('to:"/sentinel",label:"SENTINEL"')) {
    const primaryMenuPattern =
      /\{to:"\/home",label:"Home",icon:([^,]+),permission:\{menuKey:"primary",pageKey:"home"\}\},\{to:"\/monitoring",label:"Monitoramento",icon:([^,]+),permission:\{menuKey:"primary",pageKey:"monitoring"\}\}/;
    source = source.replace(
      primaryMenuPattern,
      '{to:"/home",label:"Home",icon:$1,permission:{menuKey:"primary",pageKey:"home"}},{to:"/sentinel",label:"SENTINEL",icon:$2,permission:{menuKey:"primary",pageKey:"monitoring"}},{to:"/monitoring",label:"Monitoramento",icon:$2,permission:{menuKey:"primary",pageKey:"monitoring"}}',
    );
  }

  write(mainPath, source);
}

function main() {
  if (!fs.existsSync(assetsRoot)) {
    throw new Error(`assets ausente: ${assetsRoot}`);
  }

  const mainAsset = findAssetByPattern(/^index-.*\.js$/);
  if (!mainAsset) {
    throw new Error("bundle principal nao encontrado");
  }

  const mainCssAsset = findAssetByPattern(/^index-.*\.css$/);
  if (!mainCssAsset) {
    throw new Error("css principal nao encontrado");
  }

  const sentinelRoutePath = path.join(assetsRoot, sentinelRouteBaseName);
  const sentinelAppPath = path.join(assetsRoot, sentinelAppBaseName);
  const sentinelHtmlPath = path.join(assetsRoot, sentinelHtmlBaseName);

  writeSentinelRouteChunk(sentinelRoutePath, mainAsset);
  buildStandaloneSentinelApp(sentinelAppPath, sentinelHtmlPath, mainCssAsset);
  patchMainBundle(path.join(assetsRoot, mainAsset));

  process.stdout.write("OK: SENTINEL isolado em iframe aplicado ao 00h22\\n");
}

main();
