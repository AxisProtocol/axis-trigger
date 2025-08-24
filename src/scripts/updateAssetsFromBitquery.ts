import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../db/client";
import { BitqueryClient } from "../providers/bitquery/client";
import {
  fetchCirculatingSupply,
  fetchFoundationHoldings,
  fetchLockedSupply,
  fetchHeavilyVestedStaked,
  fetchExchangeCustodyHoldings,
  computeFreeFloat,
  type TokenIdentity,
} from "../providers/bitquery/helpers";

function parseTokenIdentity(): TokenIdentity {
  const chain = process.env.BITQUERY_CHAIN || process.env.CHAIN || "ethereum";
  const address = process.env.BITQUERY_TOKEN_ADDRESS || process.env.TOKEN_ADDRESS || "";
  const symbol = process.env.SYMBOL || undefined;
  if (!address) {
    throw new Error("Missing token address. Set BITQUERY_TOKEN_ADDRESS or TOKEN_ADDRESS.");
  }
  return { chain, address, symbol };
}

async function main(): Promise<void> {
  const token = parseTokenIdentity();
  const client = new BitqueryClient();

  const [circ, foundation, locked, vested, exchange] = await Promise.all([
    fetchCirculatingSupply(client, token),
    fetchFoundationHoldings(client, token),
    fetchLockedSupply(client, token),
    fetchHeavilyVestedStaked(client, token),
    fetchExchangeCustodyHoldings(client, token),
  ]);

  const breakdown = {
    circulatingSupply: circ ?? 0,
    foundationHoldings: foundation ?? 0,
    lockedSupply: locked ?? 0,
    heavilyVestedStaked: vested ?? 0,
    exchangeCustodyHoldings: exchange ?? 0,
  };
  const { freeFloat } = computeFreeFloat(breakdown);

  const symbol = (token.symbol || process.env.SYMBOL || "").toUpperCase();
  if (!symbol) {
    throw new Error("Missing SYMBOL for upserting Asset. Provide SYMBOL env.");
  }

  await prisma.asset.upsert({
    where: { symbol },
    create: {
      symbol,
      coingeckoId: null,
      binanceSymbol: null,
      circulatingSupply: breakdown.circulatingSupply.toString(),
      foundationHoldings: breakdown.foundationHoldings.toString(),
      lockedSupply: breakdown.lockedSupply.toString(),
      heavilyVestedStaked: breakdown.heavilyVestedStaked.toString(),
      exchangeCustodyHoldings: breakdown.exchangeCustodyHoldings.toString(),
    },
    update: {
      circulatingSupply: breakdown.circulatingSupply.toString(),
      foundationHoldings: breakdown.foundationHoldings.toString(),
      lockedSupply: breakdown.lockedSupply.toString(),
      heavilyVestedStaked: breakdown.heavilyVestedStaked.toString(),
      exchangeCustodyHoldings: breakdown.exchangeCustodyHoldings.toString(),
    },
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ symbol, ...breakdown, freeFloat }, null, 2));
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });


