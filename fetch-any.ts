import { fromFileUrl } from "https://deno.land/std@0.128.0/path/mod.ts";
import { grantOrThrow } from "https://deno.land/std@0.128.0/permissions/mod.ts";

export function fetchAny(target: string) {
  try {
    const url = new URL(target);
    return fetchURL(url);
  } catch {
    return fetchFile(target);
  }
}

async function fetchURL(target: URL) {
  if (target.protocol == "file:") {
    return fetchFile(fromFileUrl(target));
  }
  await grantOrThrow({ name: "net", host: target.host });
  const resp = await fetch(target);
  if (!resp.ok) throw new Error("failed to request url: " + target);
  return resp.text();
}

async function fetchFile(target: string) {
  await grantOrThrow({ name: "read", path: target });
  return Deno.readTextFile(target);
}
