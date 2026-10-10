/**
 * BibliothecaDAO Marketplace: Independent Collection Historical Backfill Engine
 * Implements Issue #113: Support independent collection backfills without rebuilding the live database.
 */

import { address } from "./domain_shim.mjs";
import { TRANSFER_SELECTOR } from "./discovery_engine.mjs";

export class CollectionBackfillEngine {
  constructor(store, rpc, config = {}) {
    this.store = store;
    this.rpc = rpc;
    this.chainId = config.chainId || "SN_MAIN";
    this.chunkSize = config.chunkSize || 500; // bounded block chunk to respect RPC limits
  }

  /**
   * Backfills a specific collection from startBlock up to targetBlock.
   * Preserves checkpointing in nft_collections.synced_up_to_block.
   * @param {string} contractAddress 
   * @param {number} targetBlock 
   */
  async backfillCollection(contractAddress, targetBlock) {
    const target = address(contractAddress);

    // 1. Fetch current sync progress
    const colRes = await this.store.query(
      `SELECT deployment_block, synced_up_to_block, backfill_status 
       FROM nft_collections 
       WHERE chain_id = $1 AND contract_address = $2`,
      [this.chainId, target]
    );

    if (!colRes.rows || colRes.rows.length === 0) {
      throw new Error(`Collection ${target} not found in catalog.`);
    }

    const row = colRes.rows[0];
    let fromBlock = Math.max(Number(row.deployment_block), Number(row.synced_up_to_block) + 1);

    if (fromBlock > targetBlock) {
      return { status: "ALREADY_SYNCED", syncedUpTo: row.synced_up_to_block };
    }

    // Set status to SYNCING
    await this.store.query(
      `UPDATE nft_collections SET backfill_status = 'SYNCING' WHERE chain_id = $1 AND contract_address = $2`,
      [this.chainId, target]
    );

    console.log(`[*] Starting backfill for ${target}: blocks ${fromBlock} -> ${targetBlock} in chunks of ${this.chunkSize}`);

    try {
      while (fromBlock <= targetBlock) {
        const toBlock = Math.min(fromBlock + this.chunkSize - 1, targetBlock);

        // Fetch events for this specific collection using starknet_getEvents
        const eventFilter = {
          from_block: { block_number: fromBlock },
          to_block: { block_number: toBlock },
          address: target,
          keys: [[TRANSFER_SELECTOR]],
          chunk_size: 1000
        };

        const eventsRes = await this.rpc.call("starknet_getEvents", [eventFilter]);
        const events = eventsRes.events || [];

        // Transactionally commit events and advance checkpoint
        await this.store.transaction(async (client) => {
          for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            const low = BigInt(ev.data[0]);
            const high = BigInt(ev.data[1]);
            const tokenId = ((high << 128n) + low).toString();
            const from = address(ev.keys[1]);
            const to = address(ev.keys[2]);

            await client.query(
              `INSERT INTO canonical_nft_event_journal 
               (chain_id, contract_address, block_number, tx_hash, event_index, event_type, from_address, to_address, token_id, raw_keys, raw_data)
               VALUES ($1, $2, $3, $4, $5, 'TRANSFER', $6, $7, $8, $9, $10)
               ON CONFLICT (chain_id, contract_address, block_number, event_index, tx_hash) DO NOTHING`,
              [this.chainId, target, ev.block_number, ev.transaction_hash, i, from, to, tokenId, JSON.stringify(ev.keys), JSON.stringify(ev.data)]
            );

            await client.query(
              `INSERT INTO nft_ownership_projections 
               (chain_id, contract_address, token_id, owner_address, last_transferred_block, last_transferred_tx, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())
               ON CONFLICT (chain_id, contract_address, token_id, owner_address)
               DO UPDATE SET 
                 last_transferred_block = EXCLUDED.last_transferred_block,
                 last_transferred_tx = EXCLUDED.last_transferred_tx,
                 updated_at = NOW()`,
              [this.chainId, target, tokenId, to, ev.block_number, ev.transaction_hash]
            );
          }

          // Advance collection checkpoint
          await client.query(
            `UPDATE nft_collections 
             SET synced_up_to_block = $1, backfill_status = $2 
             WHERE chain_id = $3 AND contract_address = $4`,
            [toBlock, toBlock >= targetBlock ? 'SYNCED' : 'SYNCING', this.chainId, target]
          );
        });

        fromBlock = toBlock + 1;
      }

      console.log(`[+] Backfill successfully completed for ${target} up to block ${targetBlock}`);
      return { status: "SYNCED", syncedUpTo: targetBlock };
    } catch (err) {
      await this.store.query(
        `UPDATE nft_collections SET backfill_status = 'FAILED', error_message = $1 WHERE chain_id = $2 AND contract_address = $3`,
        [err.message, this.chainId, target]
      );
      throw err;
    }
  }
}

export function calculateBackfillChunks(fromBlock, targetBlock, chunkSize = 500) {
  const chunks = [];
  let curr = fromBlock;
  while (curr <= targetBlock) {
    const to = Math.min(curr + chunkSize - 1, targetBlock);
    chunks.push({ from: curr, to });
    curr = to + 1;
  }
  return chunks;
}
