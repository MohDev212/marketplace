-- BibliothecaDAO Marketplace: Starknet-Wide NFT Discovery & Catalog Schema
-- Conforms to Issue #108 / #109 (database-backed collection catalog & source coverage model)
-- Direct PostgreSQL schema with strict idempotency and chain-specific partitioning.

CREATE TABLE IF NOT EXISTS nft_collections (
    chain_id VARCHAR(32) NOT NULL,
    contract_address VARCHAR(66) NOT NULL,
    standard VARCHAR(32) NOT NULL, -- 'ERC721_STANDARD', 'ERC721_LEGACY', 'ERC1155_HOLDINGS', 'UNSUPPORTED'
    name TEXT,
    symbol VARCHAR(32),
    cairo_version INTEGER NOT NULL DEFAULT 1, -- 0 for Cairo 0, 1 for Cairo 1 / Sierra
    class_hash VARCHAR(66),
    deployment_block BIGINT NOT NULL,
    deployment_tx_hash VARCHAR(66) NOT NULL,
    discovery_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    backfill_status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'SYNCING', 'SYNCED', 'FAILED'
    synced_up_to_block BIGINT NOT NULL DEFAULT 0,
    total_supply_cached NUMERIC(78, 0) DEFAULT 0,
    is_trading_enabled BOOLEAN NOT NULL DEFAULT FALSE, -- Production policy: trading activation requires separate admin review
    is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    PRIMARY KEY (chain_id, contract_address)
);

CREATE INDEX IF NOT EXISTS idx_nft_collections_status 
ON nft_collections (chain_id, backfill_status, standard);

CREATE TABLE IF NOT EXISTS contract_upgrades (
    chain_id VARCHAR(32) NOT NULL,
    contract_address VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    old_class_hash VARCHAR(66),
    new_class_hash VARCHAR(66) NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, contract_address, block_number, tx_hash),
    FOREIGN KEY (chain_id, contract_address) REFERENCES nft_collections(chain_id, contract_address) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS canonical_nft_event_journal (
    chain_id VARCHAR(32) NOT NULL,
    contract_address VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    event_index INTEGER NOT NULL,
    event_type VARCHAR(32) NOT NULL, -- 'TRANSFER', 'UPGRADE', 'APPROVAL', 'APPROVAL_ALL'
    from_address VARCHAR(66) NOT NULL,
    to_address VARCHAR(66) NOT NULL,
    token_id NUMERIC(78, 0),
    amount NUMERIC(78, 0) DEFAULT 1, -- For ERC-1155 holdings
    raw_keys JSONB NOT NULL,
    raw_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, contract_address, block_number, event_index, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_event_journal_token 
ON canonical_nft_event_journal (chain_id, contract_address, token_id, block_number DESC);

CREATE TABLE IF NOT EXISTS nft_ownership_projections (
    chain_id VARCHAR(32) NOT NULL,
    contract_address VARCHAR(66) NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL,
    owner_address VARCHAR(66) NOT NULL,
    balance NUMERIC(78, 0) NOT NULL DEFAULT 1,
    last_transferred_block BIGINT NOT NULL,
    last_transferred_tx VARCHAR(66) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chain_id, contract_address, token_id, owner_address)
);

CREATE INDEX IF NOT EXISTS idx_nft_projections_owner 
ON nft_ownership_projections (chain_id, owner_address);

CREATE TABLE IF NOT EXISTS metadata_enrichment_queue (
    chain_id VARCHAR(32) NOT NULL,
    contract_address VARCHAR(66) NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED', -- 'QUEUED', 'FETCHING', 'ENRICHED', 'FAILED'
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata_uri TEXT,
    metadata_json JSONB,
    last_error TEXT,
    PRIMARY KEY (chain_id, contract_address, token_id)
);

CREATE INDEX IF NOT EXISTS idx_metadata_queue_status 
ON metadata_enrichment_queue (status, next_retry_at);
