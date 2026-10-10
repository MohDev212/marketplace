/**
 * BibliothecaDAO Marketplace: Starknet NFT Deployment & Upgrade Discovery Engine
 * Implements Issue #110: Discover historical and live contract deployments and upgrades.
 * Uses native Node.js and Starknet JSON-RPC specification.
 */

import { address, ApiError } from "./domain_shim.mjs";

// Standard Starknet Event Selectors (sn_keccak)
// Transfer(from, to, token_id) = 0x99cd8bde557814842a312181a68295d9be90c5c823a63393b47d12f615f32bc
export const TRANSFER_SELECTOR = "0x99cd8bde557814842a312181a68295d9be90c5c823a63393b47d12f615f32bc";
// Upgraded(class_hash) = 0x2289659b8be4d8f1d8ab1f109040fe8c2f159eb54483ae5947a5089c1ed67
export const UPGRADED_SELECTOR = "0x2289659b8be4d8f1d8ab1f109040fe8c2f159eb54483ae5947a5089c1ed67";

export class DiscoveryEngine {
  constructor(store, rpc, config = {}) {
    this.store = store;
    this.rpc = rpc;
    this.chainId = config.chainId || "SN_MAIN";
    this.batchSize = config.batchSize || 50;
  }

  /**
   * Scans a specific block for DEPLOY transactions and Upgraded events.
   * @param {number} blockNumber 
   * @returns {Promise<Array<{type: string, contractAddress: string, classHash?: string, txHash: string}>>}
   */
  async scanBlockForDeployments(blockNumber) {
    const block = await this.rpc.call("starknet_getBlockWithTxs", [{ block_number: blockNumber }]);
    if (!block || !block.transactions) {
      return [];
    }

    const discovered = [];

    for (const tx of block.transactions) {
      const txType = tx.type;
      
      // 1. Direct DEPLOY or DEPLOY_ACCOUNT transactions
      if (txType === "DEPLOY" || txType === "DEPLOY_ACCOUNT") {
        const contractAddress = address(tx.contract_address);
        const classHash = tx.class_hash ? address(tx.class_hash) : null;
        discovered.push({
          type: "DEPLOYMENT",
          contractAddress,
          classHash,
          deploymentBlock: blockNumber,
          txHash: tx.transaction_hash
        });
      }
    }

    // 2. Scan block events for factory deployments or contract upgrades
    const receipts = await this.rpc.call("starknet_getBlockWithReceipts", [{ block_number: blockNumber }]).catch(() => null);
    if (receipts && receipts.transactions) {
      for (const item of receipts.transactions) {
        const events = item.receipt?.events || [];
        for (const ev of events) {
          const keys = ev.keys || [];
          if (keys.length > 0 && keys[0].toLowerCase() === UPGRADED_SELECTOR.toLowerCase()) {
            const contractAddress = address(ev.from_address);
            const newClassHash = address(ev.data[0]);
            discovered.push({
              type: "UPGRADE",
              contractAddress,
              newClassHash,
              blockNumber,
              txHash: item.receipt.transaction_hash
            });
          }
        }
      }
    }

    return discovered;
  }

  /**
   * Records newly discovered candidate contracts into PostgreSQL catalog.
   */
  async recordCandidates(candidates) {
    for (const item of candidates) {
      if (item.type === "DEPLOYMENT") {
        await this.store.query(
          `INSERT INTO nft_collections 
           (chain_id, contract_address, standard, class_hash, deployment_block, deployment_tx_hash, backfill_status)
           VALUES ($1, $2, 'PENDING_CLASSIFICATION', $3, $4, $5, 'PENDING')
           ON CONFLICT (chain_id, contract_address) DO NOTHING`,
          [this.chainId, item.contractAddress, item.classHash, item.deploymentBlock, item.txHash]
        );
      } else if (item.type === "UPGRADE") {
        await this.store.query(
          `INSERT INTO contract_upgrades 
           (chain_id, contract_address, block_number, tx_hash, new_class_hash)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (chain_id, contract_address, block_number, tx_hash) DO NOTHING`,
          [this.chainId, item.contractAddress, item.blockNumber, item.txHash, item.newClassHash]
        );
      }
    }
  }
}
