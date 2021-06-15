import type { ModDef } from "./types.ts";
import type { DownloadInfo, ModInfo } from "./api/mod.ts";
import apis from "./api/mod.ts";

export function fetchInfo(id: URL): Promise<ModInfo> {
  const key = id.protocol.slice(0, -1);
  if (key in apis) {
    return apis[key](id);
  } else {
    throw new Error(`invalid protocol: ${key}`);
  }
}

export function resolveVersion(
  version: string,
  def: ModDef,
  info: ModInfo,
): Promise<DownloadInfo> {
  const resolvedVersion = "" + (def.version ?? version);
  const channel = def.channel || "release";
  const fileInfo = info.files.find((x) =>
    x.version.includes(resolvedVersion) && x.channel == channel
  );
  if (!fileInfo) {
    console.info(
      info.files.map(
        (x) => `[${x.version.join(", ")}] ${x.channel}`,
      ).join("\n"),
    );
    throw new Error(
      `no required version found for ${info.name} (version=${resolvedVersion}, channel=${channel})`,
    );
  }
  return fileInfo.downloadable.info();
}
