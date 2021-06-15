import { Md5 } from "https://deno.land/std@0.98.0/hash/md5.ts";
import { grantOrThrow } from "https://deno.land/std@0.98.0/permissions/mod.ts";
import { ReleaseChannel } from "../types.ts";
import { downloadJson } from "../utils.ts";
import { Downloadable, DownloadInfo, ModInfo } from "./base.ts";

const curseproxy = `curse.nikky.moe`;

class CurseForgeDownloader implements Downloadable {
  constructor(public addon: number, public file: number) {}
  etag(file: Uint8Array): string {
    const md5 = new Md5();
    md5.update(file);
    return JSON.stringify(md5.toString("hex").toLowerCase());
  }
  async info(): Promise<DownloadInfo> {
    interface CurseForgeFileInfo {
      fileName: string;
      downloadUrl: string;
    }
    await grantOrThrow({ name: "net", host: curseproxy });
    const json = await downloadJson(
      `https://${curseproxy}/api/addon/${this.addon}/file/${this.file}`,
    ) as CurseForgeFileInfo;
    return {
      source: this,
      filename: json.fileName,
      url: new URL(json.downloadUrl),
      "_addition_hosts": ["media.forgecdn.net"],
    };
  }
}

function parseCurseForge(data: unknown): ModInfo {
  interface CurseForgeModInfo {
    id: number;
    name: string;
    authors: Array<{
      name: string;
      projectTitleTitle: string;
    }>;
    websiteUrl: string;
    summary: string;
    gameVersionLatestFiles: Array<{
      gameVersion: string;
      projectFileId: number;
      projectFileName: string;
      fileType: number;
    }>;
  }
  const typed = data as CurseForgeModInfo;
  return {
    name: typed.name,
    summary: typed.summary,
    url: new URL(typed.websiteUrl),
    authors: typed.authors.map((x) => ({
      name: x.name,
      title: x.projectTitleTitle,
    })),
    files: typed.gameVersionLatestFiles.map((x) => ({
      version: [x.gameVersion],
      downloadable: new CurseForgeDownloader(typed.id, x.projectFileId),
      channel: (["release", "beta", "alpha"][x.fileType - 1] ??
        "release") as ReleaseChannel,
    })),
  };
}

export default async function (id: URL): Promise<ModInfo> {
  await grantOrThrow({ name: "net", host: curseproxy });
  const resp = await downloadJson(
    `https://${curseproxy}/api/addon/${id.pathname}`,
  );
  return parseCurseForge(resp);
}
