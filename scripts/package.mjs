import { mkdir, readFile, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const files = [
  "plugin.json", "package.json", "main.py", "README.md", "dist/index.js", "defaults/prompts.json", "defaults/prompts.en.json",
  "py_modules/screenshot.py", "py_modules/cdp.py", "py_modules/web_driver.py", "py_modules/grips.py",
  "py_modules/selectors.json", "py_modules/driver.js", "py_modules/dark_mode.js",
];
const entries = await Promise.all(files.map(async file => [`${manifest.name}/${file}`, await readFile(file)]));
const path = `release/AIDeck-${version}.zip`;
await mkdir("release", { recursive: true });
await writeFile(path, zipSync(Object.fromEntries(entries)));
console.log(path);
