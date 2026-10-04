import { NextResponse } from "next/server";
import { hermesUrl, parseFeedIds, parseHermesUpdate } from "~/lib/pyth";

export const dynamic = "force-dynamic";


/**
 * Fetch a signed Pyth price update from Hermes for the requested feeds.
 * The Pyth API key stays on the server; the browser only ever sees the signed payload.
 */
export async function GET(request: Request) {
  const ids = parseFeedIds(new URL(request.url).searchParams.get("ids"));
  if (!ids) {
    return NextResponse.json(
      { error: "Pass ids=<feedId>[,<feedId>] with 1 to 4 hex price feed IDs (0x + 64 hex characters)." },
      { status: 400 },
    );
  }

  const apiKey = process.env.PYTH_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "PYTH_API_KEY is not set on the server.",
        hint: "Hermes now requires an API key. Add PYTH_API_KEY to packages/nextjs/.env.local, or skip price refreshes and rely on prices others have published.",
      },
      { status: 503 },
    );
  }

  const baseUrl = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
  // https://pyth.dourolabs.app/hermes
  //https://hermes.pyth.network
  
  try {
    const response = await fetch(hermesUrl(baseUrl, ids), {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ error: `Hermes responded with ${response.status}.` }, { status: 502 });
    }
    const updateData = parseHermesUpdate(await response.json());
    if (!updateData) return NextResponse.json({ error: "Hermes returned an unexpected payload." }, { status: 502 });
    return NextResponse.json({ updateData });
  } catch {
    return NextResponse.json({ error: "Could not reach Hermes." }, { status: 502 });
  }
}
