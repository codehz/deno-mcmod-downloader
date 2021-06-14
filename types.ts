export type ReleaseChannel = "release" | "beta" | "alpha";

export type DeployPlatform = "client" | "server";

export type ModDef = {
  id: string;
  version?: string;
  name?: string;
  category?: string;
  platform?: DeployPlatform;
  channel?: ReleaseChannel;
};

export type Schema = {
  version: string;
  categories: Array<{ name: string }>;
  mods: Array<ModDef>;
};
