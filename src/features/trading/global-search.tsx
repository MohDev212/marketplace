"use client";
import { AssetGridSkeleton } from "@/components/marketplace/loading-state";
import { MarketplaceLink as Link } from "@/components/marketplace/marketplace-link";
import { useQuery } from "@tanstack/react-query";
import { marketplaceRequest, tokenFromApi } from "@/lib/marketplace/api-client";
import type { SearchResults } from "@/lib/marketplace/types";
import { MarketplaceTokenCard } from "@/components/marketplace/token-card";
import { SectionHeader } from "@/components/marketplace/section-header";
export function GlobalSearch({ query }: { query: string }) {
  const result = useQuery({
    queryKey: ["owned", "search", query],
    queryFn: () =>
      marketplaceRequest<SearchResults>(
        "/search",
        { q: query },
      ),
  });
  const discovered = result.data?.discoveredCollections ?? [];
  return (
    <main className="market-page space-y-8">
      <h1 className="market-page-title break-words">Search: {query}</h1>
      {result.isPending ? (
        <AssetGridSkeleton label="Searching marketplace" gridClassName="grid-cols-2 md:grid-cols-4" />
      ) : result.isError ? (
        <p role="alert">Search is unavailable. Try again shortly.</p>
      ) : (
        <>
          <section className="space-y-3">
            <SectionHeader title="Collections" count={result.data.collections.length} />
            <div className="flex flex-wrap gap-3">
              {result.data.collections.map((c) => (
                <Link
                  key={c.address}
                  className="realm-panel rounded-md p-4 hover:border-primary"
                  href={`/collections/${c.address}`}
                >
                  <span>{c.name}</span>
                  {c.basis === "indexed" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Indexed
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
          {discovered.length > 0 && (
            <section className="space-y-3" data-testid="search-discovered-collections">
              <SectionHeader title="Discovered Chain Contracts" count={discovered.length} />
              <div className="flex flex-wrap gap-3">
                {discovered.map((d) => (
                  <div
                    key={d.address}
                    className="realm-panel flex items-center gap-2 rounded-md p-3 text-xs"
                  >
                    <span className="font-mono break-all">{d.address}</span>
                    <span className="rounded border px-1.5 py-0.5 uppercase text-muted-foreground">
                      {d.standard} · {d.state} · chain scope
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="space-y-3">
            <SectionHeader title="NFTs" count={result.data.tokens.length} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {result.data.tokens.map((t) => (
                <MarketplaceTokenCard
                  key={t.id}
                  token={tokenFromApi(t)}
                  href={`/collections/${t.collection}/${t.tokenId}`}
                />
              ))}
            </div>
          </section>
          {!result.data.collections.length && !result.data.tokens.length && !discovered.length && (
            <p>No results found.</p>
          )}
        </>
      )}
    </main>
  );
}
