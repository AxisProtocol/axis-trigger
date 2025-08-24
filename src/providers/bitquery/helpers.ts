import { BitqueryClient } from "./client";

export interface TokenSupplyBreakdown {
  circulatingSupply?: number;
  foundationHoldings?: number;
  lockedSupply?: number;
  heavilyVestedStaked?: number;
  exchangeCustodyHoldings?: number;
}

export interface TokenIdentity {
  chain: string; // e.g., "ethereum"
  address: string; // checksummed or lowercase
  symbol?: string;
}

export interface FreeFloatResult extends Required<TokenSupplyBreakdown> {
  freeFloat: number;
  source: "bitquery";
  asOf: string;
}

// NOTE: Bitquery has many datasets. Here we define narrow, composable queries.

const ERC20_SUPPLY_QUERY = /* GraphQL */ `
  query TokenSupply($network: EthereumNetwork!, $address: String!) {
    ethereum(network: $network) {
      address(address: {is: $address}) {
        annotation
      }
      transfers(currency: {is: $address}) {
        amount
      }
    }
  }
`;

// Placeholder: In practice you will use the appropriate Bitquery dataset for balances by owner labels
// such as team, foundation, vesting contracts, and exchange custody wallets.

export async function fetchCirculatingSupply(_: BitqueryClient, __: TokenIdentity): Promise<number | undefined> {
  // Implement a proper query once exact Bitquery dataset fields are finalized.
  return undefined;
}

export async function fetchFoundationHoldings(_: BitqueryClient, __: TokenIdentity): Promise<number | undefined> {
  return undefined;
}

export async function fetchLockedSupply(_: BitqueryClient, __: TokenIdentity): Promise<number | undefined> {
  return undefined;
}

export async function fetchHeavilyVestedStaked(_: BitqueryClient, __: TokenIdentity): Promise<number | undefined> {
  return undefined;
}

export async function fetchExchangeCustodyHoldings(_: BitqueryClient, __: TokenIdentity): Promise<number | undefined> {
  return undefined;
}

export function computeFreeFloat(breakdown: TokenSupplyBreakdown): FreeFloatResult {
  const circulatingSupply = breakdown.circulatingSupply ?? 0;
  const foundationHoldings = breakdown.foundationHoldings ?? 0;
  const lockedSupply = breakdown.lockedSupply ?? 0;
  const heavilyVestedStaked = breakdown.heavilyVestedStaked ?? 0;
  const exchangeCustodyHoldings = breakdown.exchangeCustodyHoldings ?? 0;
  const freeFloat = circulatingSupply - (foundationHoldings + lockedSupply + heavilyVestedStaked) + exchangeCustodyHoldings;
  return {
    circulatingSupply,
    foundationHoldings,
    lockedSupply,
    heavilyVestedStaked,
    exchangeCustodyHoldings,
    freeFloat,
    source: "bitquery",
    asOf: new Date().toISOString()
  };
}


