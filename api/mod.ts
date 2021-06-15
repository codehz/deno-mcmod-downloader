export * from "./base.ts";

import type { ModInfo } from "./base.ts";
import curseforge from "./curseforge.ts";
import modrinth from "./modrinth.ts";

export default {
  curseforge,
  modrinth,
} as Record<string, (id: URL) => Promise<ModInfo>>;
