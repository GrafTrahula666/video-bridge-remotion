export function GET() {
  return Response.json(
    {
      ok: true,
      configured: Boolean(
        process.env.BLOB_READ_WRITE_TOKEN &&
          process.env.VIDEOBRIDGE_ACCESS_KEY &&
          process.env.VIDEOBRIDGE_SIGNING_SECRET &&
          process.env.CRON_SECRET,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
