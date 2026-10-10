import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../src/discovery/catalog_schema.sql");

test("Starknet Discovery: catalog_schema.sql defines required tables and indexes", () => {
  assert.ok(fs.existsSync(schemaPath), "catalog_schema.sql exists");
  const sql = fs.readFileSync(schemaPath, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS nft_collections/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS canonical_nft_event_journal/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nft_ownership_projections/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS metadata_enrichment_queue/i);
  assert.match(sql, /synced_up_to_block/i);
  assert.match(sql, /is_trading_enabled\s+BOOLEAN/i);
});

test("Starknet Discovery: decodes u256 transfer events correctly", async () => {
  const { decodeTransferEvent } = await import("../src/discovery/shared_block_reader.mjs");
  
  // Standard Transfer event: keys[0]=sn_keccak("Transfer"), data=[from, to, token_id_low, token_id_high]
  const mockEvent = {
    from_address: "0x0123456789abcdef",
    keys: ["0x99cd8bde557814842a312181a682da537fb1700177c9cb452ca9e24738eb3b6"],
    data: [
      "0x0000000000000000000000000000000000000000000000000000000000000000", // from (mint)
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", // to
      "0x2a", // token_id low (42)
      "0x0"   // token_id high (0)
    ]
  };

  const decoded = decodeTransferEvent(mockEvent);
  assert.ok(decoded, "Decodes successfully");
  assert.equal(decoded.from, "0x0000000000000000000000000000000000000000000000000000000000000000");
  assert.equal(decoded.to, "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7");
  assert.equal(decoded.tokenId, "42");
});

test("Starknet Discovery: backfill chunker respects maximum block chunk bounds", async () => {
  const { calculateBackfillChunks } = await import("../src/discovery/collection_backfill.mjs");

  const startBlock = 1000;
  const targetBlock = 2500;
  const chunkSize = 500;

  const chunks = calculateBackfillChunks(startBlock, targetBlock, chunkSize);
  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks[0], { from: 1000, to: 1499 });
  assert.deepEqual(chunks[1], { from: 1500, to: 1999 });
  assert.deepEqual(chunks[2], { from: 2000, to: 2499 });
  assert.deepEqual(chunks[3], { from: 2500, to: 2500 });
});

test("Starknet Discovery: classifier classifies SRC-5 ERC-721 and isolates unsupported contracts", async () => {
  const { classifyContract } = await import("../src/discovery/nft_classifier.mjs");

  // Mock RPC client that returns true for ERC-721 interface 0x80ac58cd
  const mockRpcErc721 = {
    async callContract({ entry_point_selector, calldata }) {
      if (calldata && calldata[0] === "0x80ac58cd") {
        return ["0x1"]; // true
      }
      return ["0x0"];
    }
  };

  const resultErc721 = await classifyContract("0xmock_nft", mockRpcErc721);
  assert.equal(resultErc721.standard, "ERC721_STANDARD");
  assert.equal(resultErc721.supported, true);

  // Mock RPC client that fails or returns false
  const mockRpcUnsupported = {
    async callContract() {
      throw new Error("ENTRYPOINT_NOT_FOUND");
    }
  };

  const resultUnsupported = await classifyContract("0xrandom_contract", mockRpcUnsupported);
  assert.equal(resultUnsupported.standard, "UNSUPPORTED");
  assert.equal(resultUnsupported.supported, false);
});