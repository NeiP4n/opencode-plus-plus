export * as HubBuild from "./build.js"

import type { Entry } from "../types.js"

// Building, testing and looking at apps across common stacks: Node, .NET, Rust, Tauri and
// a rendered web page. Each runs the project's own toolchain from the working directory.
export const entries: Entry[] = [
  {
    id: "build.npm-scripts",
    title: "npm scripts",
    description: "List the scripts the package defines (build, test, dev…)",
    category: "build",
    requires: ["npm"],
    templates: { bash: "npm run" },
  },
  {
    id: "build.npm-run",
    title: "Run an npm script",
    description: "Run one of the package's scripts, such as build, lint or test",
    category: "build",
    requires: ["npm"],
    templates: { bash: "npm run {script}" },
  },
  {
    id: "build.npm-test",
    title: "npm test",
    description: "Run the package's test script",
    category: "build",
    requires: ["npm"],
    templates: { bash: "npm test" },
  },
  {
    id: "build.tsc",
    title: "TypeScript type check",
    description: "Type-check a TypeScript project without emitting files",
    category: "build",
    requires: ["npx"],
    templates: { bash: "npx --yes tsc --noEmit" },
  },
  {
    id: "build.page-screenshot",
    title: "Screenshot a web page",
    description: "Render a URL (such as the local dev server) in a headless browser and save a PNG",
    category: "build",
    requires: ["npx"],
    templates: { bash: "npx --yes playwright screenshot --full-page {url} {output}" },
  },
  {
    id: "build.dotnet-build",
    title: ".NET build",
    description: "Build a .NET solution or project",
    category: "build",
    requires: ["dotnet"],
    templates: { bash: "dotnet build {project?}" },
  },
  {
    id: "build.dotnet-test",
    title: ".NET tests",
    description: "Run the tests of a .NET solution or project",
    category: "build",
    requires: ["dotnet"],
    templates: { bash: "dotnet test {project?}" },
  },
  {
    id: "build.cargo-check",
    title: "Rust check",
    description: "Type-check a Rust crate or workspace quickly, without building binaries",
    category: "build",
    requires: ["cargo"],
    templates: { bash: "cargo check --all-targets" },
  },
  {
    id: "build.cargo-test",
    title: "Rust tests",
    description: "Run the tests of a Rust crate or workspace",
    category: "build",
    requires: ["cargo"],
    templates: { bash: "cargo test {filter?}" },
  },
  {
    id: "build.tauri-info",
    title: "Tauri environment",
    description: "Tauri, Rust, WebView and bundler versions for a desktop app",
    category: "build",
    requires: ["npx"],
    templates: { bash: "npx --yes tauri info" },
  },
]
