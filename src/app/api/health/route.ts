import { getVercelOidcToken } from "@vercel/oidc";

async function hasBlobCredentials(): Promise<boolean> {
  if (process.env.BLOB_READ_WRITE_TOKEN) return true;
  if (!process.env.BLOB_STORE_ID) return false;

  try {
    return Boolean((await getVercelOidcToken()).trim());
  } catch {
    return false;
  }
}

export async function GET() {
  const blobConfigured = await hasBlobCredentials();

  return Response.json(
    {
      ok: true,
      configured: Boolean(
        blobConfigured &&
          process.env.VIDEOBRIDGE_ACCESS_KEY &&
          process.env.VIDEOBRIDGE_SIGNING_SECRET &&
          process.env.CRON_SECRET,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
