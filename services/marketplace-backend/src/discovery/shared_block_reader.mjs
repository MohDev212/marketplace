/**
 * BibliothecaDAO Marketplace: Multiplexed Shared Live Block Acquisition Reader
 * Implements Issue #114: Share live block acquisition across discovered collections.
 * Avoids per-collection RPC polling; evaluates all discovered collections in one pass per block.
 */

import { address } from "./domain_shim.mjs";
import { TRANSFER_SELECTOR } from "./discovery_engine.mjs";

export class SharedBlockReader {
  constructor(store, rpc, config = {}) {
    this.store = store;
    this.rpc = rpc;
    this.chainId = config.chainId || "SN_MAIN";
  }

  /**
   * Processes a live block height across all actively tracked NFT collections.
   * @param {number} blockNumber 
   */
  async processBlock(blockNumber) {
    // 1. Fetch all tracked collections from PostgreSQL catalog
    const activeCollections = await this.store.query(
      `SELECT contract_address, standard FROM nft_collections 
       WHERE chain_id = $1 AND backfill_status = 'SYNCED' AND is_blacklisted = FALSE`,
      [this.chainId]
    );

    if (!activeCollections.rows || activeCollections.rows.length === 0) {
      return { blockNumber, processedEvents: 0 };
    }

    const trackedAddresses = new Set(
      activeCollections.rows.map(r => address(r.contract_address).toLowerCase())
    );

    // 2. Query block receipts once for all transactions in this block
    const blockReceipts = await this.rpc.call("starknet_getBlockWithReceipts", [
      { block_number: blockNumber }
    ]);

    if (!blockReceipts || !blockReceipts.transactions) {
      return { blockNumber, processedEvents: 0 };
    }

    const journalEntries = [];
    const projections = [];

    // 3. Filter and decode events matching tracked collections
    for (const txData of blockReceipts.transactions) {
      const txHash = txData.receipt.transaction_hash;
      const events = txData.receipt.events || [];

      for (let idx = 0; idx < events.length; idx++) {
        const ev = events[idx];
        const contractAddr = address(ev.from_address).toLowerCase();

        if (trackedAddresses.has(contractAddr)) {
          const keys = ev.keys || [];
          if (keys.length > 0 && keys[0].toLowerCase() === TRANSFER_SELECTOR.toLowerCase()) {
            const decoded = this.decodeTransfer(ev);
            if (decoded) {
              journalEntries.push({
                chainId: this.chainId,
                contractAddress: address(ev.from_address),
                blockNumber,
                txHash,
                eventIndex: idx,
                eventType: "TRANSFER",
                from: decoded.from,
                to: decoded.to,
                tokenId: decoded.tokenId,
                rawKeys: JSON.stringify(ev.keys),
                rawData: JSON.stringify(ev.data)
              });

              projections.push({
                chainId: this.chainId,
                contractAddress: address(ev.from_address),
                tokenId: decoded.tokenId,
                ownerAddress: decoded.to,
                blockNumber,
                txHash
              });
            }
          }
        }
      }
    }

    // 4. Transactionally commit journal and ownership projections in one batch
    if (journalEntries.length > 0) {
      await this.store.transaction(async (client) => {
        for (const j of journalEntries) {
          await client.query(
            `INSERT INTO canonical_nft_event_journal 
             (chain_id, contract_address, block_number, tx_hash, event_index, event_type, from_address, to_address, token_id, raw_keys, raw_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (chain_id, contract_address, block_number, event_index, tx_hash) DO NOTHING`,
            [j.chainId, j.contractAddress, j.blockNumber, j.txHash, j.eventIndex, j.eventType, j.from, j.to, j.tokenId, j.rawKeys, j.rawData]
          );
        }

        for (const p of projections) {
          await client.query(
            `INSERT INTO nft_ownership_projections 
             (chain_id, contract_address, token_id, owner_address, last_transferred_block, last_transferred_tx, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (chain_id, contract_address, token_id, owner_address)
             DO UPDATE SET 
               last_transferred_block = EXCLUDED.last_transferred_block,
               last_transferred_tx = EXCLUDED.last_transferred_tx,
               updated_at = NOW()`,
            [p.chainId, p.contractAddress, p.tokenId, p.ownerAddress, p.blockNumber, p.txHash]
          );
        }
      });
    }

    return { blockNumber, processedEvents: journalEntries.length };
  }

  decodeTransfer(event) {
    return decodeTransferEvent(event);
  }
}

export function decodeTransferEvent(event) {
  try {
    // Layout A: Indexed keys [TRANSFER_SELECTOR, from, to], data [token_id_low, token_id_high]
    if (event.keys && event.keys.length >= 3 && event.data && event.data.length >= 2) {
      const from = address(event.keys[1]);
      const to = address(event.keys[2]);
      const low = BigInt(event.data[0]);
      const high = BigInt(event.data[1]);
      const tokenId = ((high << 128n) + low).toString();
      return { from, to, tokenId };
    }
    // Layout B: Cairo 0 data [from, to, token_id_low, token_id_high]
    if (event.data && event.data.length >= 4) {
      const from = address(event.data[0]);
      const to = address(event.data[1]);
      const low = BigInt(event.data[2]);
      const high = BigInt(event.data[3]);
      const tokenId = ((high << 128n) + low).toString();
      return { from, to, tokenId };
    }
  } catch {}
  return null;
}
