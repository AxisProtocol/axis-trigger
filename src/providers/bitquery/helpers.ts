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

// NOTE: Bitquery has many datasets. We use flexible queries to sum balances either by explicit
// address lists or by owner labels (annotations). Exact field names can vary across networks,
// but GraphQL strings are opaque to TypeScript and safe to compile. See docs:
// https://docs.bitquery.io/v1/docs/intro

// Attempt to fetch total/circulating supply from token metadata where available.
export async function fetchCirculatingSupply(client: BitqueryClient, token: TokenIdentity): Promise<number | undefined> {
  const query = /* GraphQL */ `
    query TokenMeta($network: EthereumNetwork!, $token: String!) {
      ethereum(network: $network) {
        smartContract(address: {is: $token}) {
          currency {
            symbol
            decimals
            totalSupply
            circulatingSupply
          }
        }
      }
    }
  `;
  try {
    const data = await client.query<any>(query, { network: token.chain as any, token: token.address });
    const c = data?.ethereum?.smartContract?.[0]?.currency;
    if (!c) return undefined;
    const val = c.circulatingSupply ?? c.totalSupply;
    if (typeof val === "number") return val;
    if (typeof val === "string") return Number(val);
    return undefined;
  } catch {
    return undefined;
  }
}

async function sumBalancesByAddresses(client: BitqueryClient, token: TokenIdentity, owners: string[]): Promise<number> {
  if (!owners.length) return 0;
  const query = /* GraphQL */ `
    query BalancesByOwners($network: EthereumNetwork!, $token: String!, $owners: [String!]) {
      ethereum(network: $network) {
        address(address: {in: $owners}) {
          address
          annotation
          balances(currency: {is: $token}) {
            value
          }
        }
      }
    }
  `;
  try {
    const data = await client.query<any>(query, { network: token.chain as any, token: token.address, owners });
    const rows = data?.ethereum?.address ?? [];
    let sum = 0;
    for (const row of rows) {
      const bal = row?.balances?.[0]?.value;
      if (typeof bal === "number") sum += bal;
      else if (typeof bal === "string") sum += Number(bal);
    }
    return sum;
  } catch {
    return 0;
  }
}

async function sumBalancesByLabels(client: BitqueryClient, token: TokenIdentity, labels: string[]): Promise<number> {
  if (!labels.length) return 0;
  const query = /* GraphQL */ `
    query BalancesByLabels($network: EthereumNetwork!, $token: String!, $labels: [String!]) {
      ethereum(network: $network) {
        address(annotation: {in: $labels}) {
          address
          annotation
          balances(currency: {is: $token}) {
            value
          }
        }
      }
    }
  `;
  try {
    const data = await client.query<any>(query, { network: token.chain as any, token: token.address, labels });
    const rows = data?.ethereum?.address ?? [];
    let sum = 0;
    for (const row of rows) {
      const bal = row?.balances?.[0]?.value;
      if (typeof bal === "number") sum += bal;
      else if (typeof bal === "string") sum += Number(bal);
    }
    return sum;
  } catch {
    return 0;
  }
}

function parseListEnv(key: string): string[] {
  const raw = process.env[key] || "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export async function fetchFoundationHoldings(client: BitqueryClient, token: TokenIdentity): Promise<number | undefined> {
  const owners = parseListEnv("BITQUERY_FOUNDATION_ADDRESSES");
  const labels = parseListEnv("BITQUERY_FOUNDATION_LABELS");
  const byOwners = await sumBalancesByAddresses(client, token, owners);
  const byLabels = await sumBalancesByLabels(client, token, labels);
  return byOwners + byLabels;
}

export async function fetchLockedSupply(client: BitqueryClient, token: TokenIdentity): Promise<number | undefined> {
  const owners = parseListEnv("BITQUERY_LOCKED_ADDRESSES");
  const labels = parseListEnv("BITQUERY_LOCKED_LABELS");
  const byOwners = await sumBalancesByAddresses(client, token, owners);
  const byLabels = await sumBalancesByLabels(client, token, labels);
  return byOwners + byLabels;
}

export async function fetchHeavilyVestedStaked(client: BitqueryClient, token: TokenIdentity): Promise<number | undefined> {
  const owners = parseListEnv("BITQUERY_VESTED_ADDRESSES");
  const labels = parseListEnv("BITQUERY_VESTED_LABELS");
  const byOwners = await sumBalancesByAddresses(client, token, owners);
  const byLabels = await sumBalancesByLabels(client, token, labels);
  return byOwners + byLabels;
}

export async function fetchExchangeCustodyHoldings(client: BitqueryClient, token: TokenIdentity): Promise<number | undefined> {
  const owners = parseListEnv("BITQUERY_EXCHANGE_ADDRESSES");
  const labels = parseListEnv("BITQUERY_EXCHANGE_LABELS");
  const byOwners = await sumBalancesByAddresses(client, token, owners);
  const byLabels = await sumBalancesByLabels(client, token, labels);
  return byOwners + byLabels;
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


