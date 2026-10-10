/**
 * BibliothecaDAO Marketplace: NFT Contract Interface Classifier & Versioner
 * Implements Issue #111 & #116: Classify NFT contracts, detect Cairo version, and route decoders.
 */

import { address } from "./domain_shim.mjs";

// Starknet Standard Selectors (sn_keccak of entrypoint names)
export const SELECTORS = {
  // ERC-721 standard entrypoints
  supportsInterface: "0x203582496d66e5113d5377f8888b14a9ec00c7a52292f725ea84687258b3a0d",
  ownerOf: "0x2e4263afad30923c891518314c3c95dbe830a60497b8fa01a1739b68512140",
  balanceOf: "0x2e4263afad30923c891518314c3c95dbe830a60497b8fa01a1739b68512140",
  name: "0x361458367e696363fbcc70777d07ebbd23f778160429b412376b07626597788",
  symbol: "0x2047805eee820d771ee1b268f7c9e0a248981f4a9840c1e7a6ad2c9748b64e0",
  
  // Legacy Cairo 0 entrypoints
  owner_of: "0x2e4263afad30923c891518314c3c95dbe830a60497b8fa01a1739b68512140",
  balance_of: "0x2e4263afad30923c891518314c3c95dbe830a60497b8fa01a1739b68512140",

  // ERC-1155 entrypoint
  balanceOfBatch: "0x1d53086780c1e8d98d2efebf6b4a39f60f64b4c7c88b77051939db27838622c"
};

// Interface IDs (SRC-5 / ERC-165)
export const INTERFACE_IDS = {
  ERC721: "0x80ac58cd",
  ERC721_METADATA: "0x5b5e139f",
  ERC1155: "0xd9b67a26"
};

export class NftClassifier {
  constructor(rpc) {
    this.rpc = rpc;
  }

  /**
   * Introspects contract bytecode and entrypoints via RPC to classify standard.
   * @param {string} contractAddress 
   * @returns {Promise<{standard: string, cairoVersion: number, name?: string, symbol?: string}>}
   */
  async classify(contractAddress) {
    const target = address(contractAddress);

    // 1. Check SRC-5 / ERC-165 supportsInterface for standard ERC-721
    try {
      const src5Result = await this.rpc.call("starknet_call", [
        {
          contract_address: target,
          entry_point_selector: SELECTORS.supportsInterface,
          calldata: [INTERFACE_IDS.ERC721]
        },
        "latest"
      ]);

      if (src5Result && src5Result[0] && BigInt(src5Result[0]) === 1n) {
        const metadata = await this.fetchMetadataStrings(target);
        return {
          standard: "ERC721_STANDARD",
          cairoVersion: 1,
          name: metadata.name,
          symbol: metadata.symbol
        };
      }
    } catch {
      // Contract might be Cairo 0 or not implement supportsInterface
    }

    // 2. Check for ERC-1155 interface
    try {
      const src5Result1155 = await this.rpc.call("starknet_call", [
        {
          contract_address: target,
          entry_point_selector: SELECTORS.supportsInterface,
          calldata: [INTERFACE_IDS.ERC1155]
        },
        "latest"
      ]);

      if (src5Result1155 && src5Result1155[0] && BigInt(src5Result1155[0]) === 1n) {
        return {
          standard: "ERC1155_HOLDINGS",
          cairoVersion: 1
        };
      }
    } catch {
      // Pass
    }

    // 3. Fallback: Probe Cairo 0 legacy owner_of entrypoint
    try {
      const probeResult = await this.rpc.call("starknet_call", [
        {
          contract_address: target,
          entry_point_selector: SELECTORS.owner_of,
          calldata: ["1", "0"] // tokenId u256 (low, high)
        },
        "latest"
      ]);

      // If call executes or fails specifically with TOKEN_NOT_FOUND rather than ENTRYPOINT_NOT_FOUND
      if (probeResult) {
        const metadata = await this.fetchMetadataStrings(target);
        return {
          standard: "ERC721_LEGACY",
          cairoVersion: 0,
          name: metadata.name,
          symbol: metadata.symbol
        };
      }
    } catch (err) {
      const msg = String(err.message || "");
      if (msg.includes("nonexistent") || msg.includes("not found") || msg.includes("ERC721")) {
        return {
          standard: "ERC721_LEGACY",
          cairoVersion: 0
        };
      }
    }

    return {
      standard: "UNSUPPORTED",
      cairoVersion: 1
    };
  }

  async fetchMetadataStrings(contractAddress) {
    let name = null;
    let symbol = null;
    try {
      const nameRes = await this.rpc.call("starknet_call", [
        { contract_address: contractAddress, entry_point_selector: SELECTORS.name, calldata: [] },
        "latest"
      ]);
      if (nameRes && nameRes[0]) {
        name = this.feltToString(nameRes[0]);
      }
    } catch {}

    try {
      const symRes = await this.rpc.call("starknet_call", [
        { contract_address: contractAddress, entry_point_selector: SELECTORS.symbol, calldata: [] },
        "latest"
      ]);
      if (symRes && symRes[0]) {
        symbol = this.feltToString(symRes[0]);
      }
    } catch {}

    return { name, symbol };
  }

  feltToString(felt) {
    try {
      const hex = BigInt(felt).toString(16);
      let str = "";
      for (let i = 0; i < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        if (code >= 32 && code <= 126) str += String.fromCharCode(code);
      }
      return str.trim();
    } catch {
      return null;
    }
  }
}

export async function classifyContract(contractAddress, rpcClient) {
  // Wrap rpcClient if it has callContract instead of call
  const rpcWrapper = {
    call: async (method, params) => {
      if (rpcClient.callContract) {
        return rpcClient.callContract(params[0]);
      }
      return rpcClient.call(method, params);
    }
  };
  const classifier = new NftClassifier(rpcWrapper);
  const result = await classifier.classify(contractAddress);
  return {
    standard: result.standard,
    supported: result.standard !== "UNSUPPORTED",
    cairoVersion: result.cairoVersion,
    name: result.name,
    symbol: result.symbol
  };
}
