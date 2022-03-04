import { Sha1 } from "https://deno.land/std@0.128.0/hash/sha1.ts";
import type { Downloadable, DownloadInfo, ModInfo } from "./base.ts";
import { ReleaseChannel } from "../types.ts";
import { downloadJson } from "../utils.ts";
import { grantOrThrow } from "https://deno.land/std@0.128.0/permissions/mod.ts";

const modrinth = {
  www: `www.modrinth.com`,
  api: `api.modrinth.com`,
  cdn: `cdn.modrinth.com`,
};

export class ModrinthDownloader implements Downloadable {
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
      `https://${modrinth.api}/api/v1/user/${member.user_id}`,
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

export default async function (id: URL): Promise<ModInfo> {
  await grantOrThrow({ name: "net", host: modrinth.api });
  const resp = await downloadJson(
    `https://${modrinth.api}/api/v1/mod/${id.pathname}`,
  );
  return parseModrinth(resp);
}
