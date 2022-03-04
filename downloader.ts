import type { DownloadInfo } from "./api/mod.ts";
import { join } from "https://deno.land/std@0.128.0/path/mod.ts";
import { grantOrThrow } from "https://deno.land/std@0.128.0/permissions/mod.ts";
import {
  ensureDir,
  exists,
  move,
} from "https://deno.land/std@0.128.0/fs/mod.ts";
import * as colors from "https://deno.land/std@0.128.0/fmt/colors.ts";
import { wait } from "https://deno.land/x/wait@0.1.12/mod.ts";

type DownloadState = {
  filename: string;
  total: number;
  completed: number;
};

type State =
  | { state: "request" }
  | ({ state: "download" } & DownloadState);

export default class Downloader {
  constructor(private target: string, private list: DownloadInfo[]) {}

  async run() {
    const modsBase = join(this.target, "mods");
    const modsCacheBase = join(this.target, "mods-cache");
    await grantOrThrow(
      { name: "write", path: this.target },
      { name: "read", path: this.target },
    );
    await ensureDir(modsBase);
    await ensureDir(modsCacheBase);
    await Promise.all(this.list.map(async (x) => {
      await grantOrThrow({ name: "net", host: x.url.host });
      if (x._addition_hosts) {
        for (const host of x._addition_hosts) {
          await grantOrThrow({ name: "net", host });
        }
      }
    }));
    const sp = wait({
      prefix: "download",
      text: "checking",
    }).start();
    const filelist = new Set(this.list.map((x) => x.filename));
    for await (const entry of Deno.readDir(modsBase)) {
      if (!entry.isFile || !entry.name.endsWith(".jar") || !entry.name.startsWith("_")) continue;
      if (!filelist.has(entry.name)) {
        await move(
          join(modsBase, entry.name),
          join(modsCacheBase, entry.name),
          {
            overwrite: true,
          },
        );
        sp.prefix = colors.bold(colors.yellow("purged"));
        sp.warn(
          `${colors.bold(entry.name)} (${
            colors.italic("moved to mods-cache")
          })`,
        );
        sp.prefix = "download";
        sp.start();
      }
    }
    const stateMap = new Map<string, State>(this.list.map((x) => [x.filename, {
      state: "request",
    }]));
    const update = () => {
      var downloadState: DownloadState | null = null;
      for (const item of stateMap.values()) {
        if (item.state == "download") {
          if (downloadState) {
            const prev = downloadState.completed / downloadState.total;
            const curr = item.completed / item.total;
            if (curr < prev) continue;
          }
          downloadState = item;
        }
      }
      if (!downloadState) {
        sp.text = `waiting (remain ${stateMap.size}/${this.list.length})`;
      } else {
        const percent = (downloadState.completed / downloadState.total * 100)
          .toFixed(1);
        sp.text =
          `downloading ${downloadState.filename} ${percent}% (remain ${stateMap.size}/${this.list.length})`;
      }
    };
    update();
    const succeed = (filename: string, reason?: string) => {
      sp.prefix = colors.bold(
        `[${this.list.length - stateMap.size}/${this.list.length}] ${
          colors.green("downloaded")
        }`,
      );
      if (reason) {
        sp.succeed(`${colors.bold(filename)} (${colors.italic(reason)})`);
      } else {
        sp.succeed(colors.bold(filename));
      }
      sp.prefix = "download";
      sp.start();
    };
    const proms = this.list.map(async (info) => {
      const path = join(modsBase, info.filename);
      const cachePath = join(modsCacheBase, info.filename);
      const modExists = await exists(path);
      const cacheExists = await exists(cachePath);
      if (info.source.verifyHash != null) {
        if (modExists) {
          const old = await Deno.readFile(path);
          if (info.source.verifyHash(old)) {
            stateMap.delete(info.filename);
            update();
            succeed(info.filename, "hash matched");
            return;
          }
        } else if (cacheExists) {
          const cached = await Deno.readFile(cachePath);
          if (info.source.verifyHash(cached)) {
            await Deno.writeFile(path, cached);
            stateMap.delete(info.filename);
            update();
            succeed(info.filename, "from cached, hash matched");
            return;
          }
        }
      }
      const controller = new AbortController();
      const resp = await fetch(info.url, { signal: controller.signal });
      const contentLength = resp.headers.get("content-length") ?? "100";
      const eTag = resp.headers.get("etag");
      if (info.source.etag != null && eTag != null) {
        if (modExists) {
          const old = await Deno.readFile(path);
          const oldTag = info.source.etag(old);
          if (oldTag == eTag) {
            controller.abort();
            stateMap.delete(info.filename);
            update();
            succeed(info.filename, "etag matched");
            return;
          } else {
            sp.warn(`etag ${oldTag} != ${eTag}`);
            sp.start();
          }
        } else if (cacheExists) {
          const cache = await Deno.readFile(cachePath);
          const cacheTag = info.source.etag(cache);
          if (cacheTag == eTag) {
            controller.abort();
            await Deno.writeFile(path, cache);
            stateMap.delete(info.filename);
            update();
            succeed(info.filename, "from cached, etag matched");
            return;
          } else {
            await Deno.remove(cachePath);
          }
        }
      }
      const file = await Deno.open(path, {
        write: true,
        truncate: true,
        create: true,
      });
      stateMap.set(info.filename, {
        state: "download",
        filename: info.filename,
        completed: 0,
        total: parseInt(contentLength, 10),
      });
      const reader = resp.body!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          stateMap.delete(info.filename);
          update();
          succeed(info.filename);
          break;
        }
        await file.write(value!);
        // @ts-ignore: always completed
        stateMap.get(info.filename)!.completed += value!.length;
        update();
      }
    });

    await Promise.all(proms);
    sp.stop();
  }
}
