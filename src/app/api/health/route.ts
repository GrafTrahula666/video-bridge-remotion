export function GET() {
  const blobConfigured = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  );

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
