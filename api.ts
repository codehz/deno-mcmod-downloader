import { grantOrThrow } from "https://deno.land/std@0.98.0/permissions/mod.ts";
import { Md5 } from "https://deno.land/std@0.98.0/hash/md5.ts";
import { Sha1 } from "https://deno.land/std@0.98.0/hash/sha1.ts";
import type { ModDef, ReleaseChannel } from "./types.ts";

const curseproxy = `curse.nikky.moe`;
const modrinth = {
  www: `www.modrinth.com`,
  api: `api.modrinth.com`,
  cdn: `cdn.modrinth.com`,
};

export interface DownloadInfo {
  source: Downloadable;
  filename: string;
  url: URL;
  "_addition_hosts"?: string[];
}

export interface Downloadable {
  verifyHash?(data: Uint8Array): boolean;
  etag?(data: Uint8Array): string;
  info(): Promise<DownloadInfo>;
}

export interface ModInfo {
  name: string;
  summary: string;
  url: URL;
  authors: Array<{
    name: string;
    title: string | null;
  }>;
  files: Array<{
    version: string[];
    downloadable: Downloadable;
    channel: ReleaseChannel;
  }>;
}

async function downloadJson(url: string): Promise<unknown> {
  const resp = await fetch(url);
  return await resp.json();
}

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

class ModrinthDownloader implements Downloadable {
  constructor(
    private sha1: string,
    private filename: string,
    private url: URL,
  ) {}
  verifyHash(data: Uint8Array): boolean {
    const sha1 = new Sha1();
    sha1.update(data);
    const real = sha1.hex().toLowerCase();
    return real === this.sha1;
  }
  info(): Promise<DownloadInfo> {
    return Promise.resolve({
      source: this,
      filename: this.filename,
      url: this.url,
    });
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

async function parseModrinth(data: unknown): Promise<ModInfo> {
  interface ModrinthModInfo {
    id: string;
    slug: string | null;
    title: string;
    team: string;
    description: string;
    versions: string[];
  }
  interface ModrinthVersionInfo {
    "version_type": ReleaseChannel;
    "game_versions": string[];
    files: Array<{
      hashes: {
        sha1: string;
      };
      url: string;
      filename: string;
      primary: boolean;
    }>;
  }
  interface ModrinthTeamUserInfo {
    "user_id": string;
    role: string;
  }
  interface ModrinthUserInfo {
    name: string | null;
    username: string;
  }
  const typed = data as ModrinthModInfo;
  const versions = await downloadJson(
    `https://${modrinth.api}/api/v1/versions?ids=${
      JSON.stringify(typed.versions.slice(0, 100))
    }`,
  ) as ModrinthVersionInfo[];
  const teamMembers = await downloadJson(
    `https://${modrinth.api}/api/v1/team/${typed.team}/members`,
  ) as ModrinthTeamUserInfo[];
  const authors = await Promise.all(teamMembers.map(async (member) => {
    const ui = await downloadJson(
      `https://api.modrinth.com/api/v1/user/${member.user_id}`,
    ) as ModrinthUserInfo;
    return { name: ui.name ?? ui.username, title: member.role };
  }));
  return {
    name: typed.title,
    summary: typed.description,
    url: new URL(`https://${modrinth.www}/mod/${typed.slug ?? typed.id}`),
    authors: authors,
    files: versions.map((x) => ({
      version: x.game_versions,
      downloadable: new ModrinthDownloader(
        x.files[0].hashes.sha1,
        x.files[0].filename,
        new URL(x.files[0].url),
      ),
      channel: x.version_type,
    })),
  };
}

export async function fetchInfo(id: URL): Promise<ModInfo> {
  switch (id.protocol) {
    case "curseforge:": {
      await grantOrThrow({ name: "net", host: curseproxy });
      const resp = await downloadJson(
        `https://${curseproxy}/api/addon/${id.pathname}`,
      );
      return parseCurseForge(resp);
    }
    case "modrinth:": {
      await grantOrThrow({ name: "net", host: modrinth.api });
      const resp = await downloadJson(
        `https://${modrinth.api}/api/v1/mod/${id.pathname}`,
      );
      return parseModrinth(resp);
    }
    default:
      throw new Error(`invalid protocol: ${id.protocol}`);
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
