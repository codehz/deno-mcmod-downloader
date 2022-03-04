import { parse } from "https://deno.land/std@0.128.0/encoding/yaml.ts";
import { fetchInfo, resolveVersion } from "./api.ts";
import { wait } from "https://deno.land/x/wait@0.1.12/mod.ts";
import { fetchAny } from "./fetch-any.ts";
import { Program } from "https://deno.land/x/program@0.1.6/mod.ts";
import Downloader from "./downloader.ts";
import { ensureDir } from "https://deno.land/std@0.128.0/fs/ensure_dir.ts";
import { grantOrThrow } from "https://deno.land/std@0.128.0/permissions/mod.ts";
import * as colors from "https://deno.land/std@0.128.0/fmt/colors.ts";
import type { Schema } from "./types.ts";

const program = new Program({
  name: "mcmod-downloader",
  description: "minecraft mods downloader",
  version: "0.0.0",
});

type Option = {
  platform: "server" | "client" | null;
  categories: string[];
};

function parseOption(args: Record<string, unknown>): Option {
  return {
    platform: args.server ? "server" : args.client ? "client" : null,
    categories: Array.isArray(args.category)
      ? args.category.map((x) => x + "")
      : typeof args.category == "string"
      ? [args.category + ""]
      : [],
  };
}

async function base(source: string, opts: Option) {
  const content = await fetchAny(source);
  const parsed = parse(content) as Schema;
  let mods = parsed.mods;
  const sp = wait({
    prefix: "fetching",
    text: `0/${mods.length} mods (0 resolving)`,
  }).start();
  const warn = (text: string) => {
    sp.prefix = colors.bold(colors.yellow("filter"));
    sp.warn(text);
    sp.prefix = "fetching";
    sp.start();
  };
  if (opts.platform) {
    mods = mods.filter((x) => {
      const ret = x.platform == undefined || x.platform === opts.platform;
      if (!ret) {
        warn(
          `removing ${colors.bold(x.id)}${
            x.name != null ? ` (${colors.italic(x.name)})` : ""
          } due to platform filter (require ${colors.red(opts.platform!)})`,
        );
      }
      return ret;
    });
  }
  mods = mods.filter((x) => {
    const ret = x.category == undefined || opts.categories.includes(x.category);
    if (!ret) {
      warn(
        `removing ${colors.bold(x.id)}${
          x.name != null ? ` (${colors.italic(x.name)})` : ""
        } due to category filter (require ${colors.red(x.category ?? "")})`,
      );
    }
    return ret;
  });
  let count = 0;
  let resolving = 0;
  const update = () => {
    sp.text = `${count}/${mods.length} mods (${resolving - count} resolving)`;
    sp.start();
  };
  sp.stop();
  queueMicrotask(() => sp.start());
  const ret = await Promise.all(mods.map(async (mod) => {
    const data = await fetchInfo(new URL(mod.id));
    resolving++;
    const info = await resolveVersion(parsed.version, mod, data);
    count++;
    sp.prefix = colors.bold(
      `[${count}/${mods.length}] ${colors.green("fetched")}`,
    );
    sp.succeed(`${colors.green(mod.id)} ${colors.bold(data.name)}`);
    sp.prefix = "fetching";
    console.log("filename:", colors.bold(info.filename));
    console.log("file_url:", colors.blue(colors.underline(info.url + "")));
    console.log("homepage:", colors.blue(colors.underline(data.url + "")));
    console.log("channel:", colors.bold(mod.channel ?? "release"));
    console.log("summary:", colors.italic(data.summary));
    console.log("authors:");
    for (const author of data.authors) {
      console.log(
        " -",
        author.title
          ? `${colors.bold(author.name)} (${colors.italic(author.title)})`
          : colors.bold(author.name),
      );
    }
    update();
    return info;
  }));
  sp.stop();
  return ret;
}

program
  .command({
    name: "dump",
    description: "Dump configuration file",
    fn(args) {
      const source = args._[0] + "";
      return base(source, parseOption(args));
    },
  })
  .option({
    name: "server",
    description: "Server side only",
    boolean: true,
  })
  .option({
    name: "client",
    description: "Client side only",
    boolean: true,
  })
  .option({
    name: "category",
    description: "Filter category",
    alias: "c",
    args: [{
      name: "category",
      multiple: true,
    }],
  })
  .argument({
    name: "source",
    description: "Configuration file or uri",
    multiple: false,
    optional: false,
  });

program
  .command({
    name: "fetch",
    description: "Fetch mods",
    async fn(args) {
      const source = args._[0] + "";
      const target = args._[1] + "";
      await grantOrThrow(
        { name: "write", path: target },
        { name: "read", path: target },
      );
      await ensureDir(target);
      const list = await base(source, parseOption(args));
      await new Downloader(target, list).run();
    },
  })
  .option({
    name: "server",
    description: "Server side only",
    boolean: true,
  })
  .option({
    name: "client",
    description: "Client side only",
    boolean: true,
  })
  .option({
    name: "category",
    description: "Filter category",
    alias: "c",
    args: [{
      name: "category",
      multiple: true,
    }],
  })
  .argument({
    name: "source",
    description: "Configuration file or uri",
    multiple: false,
    optional: false,
  })
  .argument({
    name: "target",
    description: "Target folder",
    multiple: false,
    optional: false,
  });

program.parse(Deno.args);
