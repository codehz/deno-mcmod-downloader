export async function downloadJson(url: string): Promise<unknown> {
  const resp = await fetch(url);
  return await resp.json();
}