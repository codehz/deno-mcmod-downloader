import type { ReleaseChannel } from "../types.ts";

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
