import { del } from "@vercel/blob";
import { sleep } from "workflow";

async function deleteBlobStep(url: string) {
  "use step";
  await del(url);
  return { deleted: true, url };
}

export async function deleteUploadAtExpiry(url: string, expiresAt: string) {
  "use workflow";
  await sleep(new Date(expiresAt));
  return deleteBlobStep(url);
}
