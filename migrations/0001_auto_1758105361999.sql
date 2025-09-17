-- CreateTable
CREATE TABLE "Price" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "price" DECIMAL NOT NULL,
    "priceTimestamp" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "coingeckoId" TEXT,
    "binanceSymbol" TEXT,
    "circulatingSupply" DECIMAL NOT NULL,
    "foundationHoldings" DECIMAL NOT NULL DEFAULT 0,
    "lockedSupply" DECIMAL NOT NULL DEFAULT 0,
    "heavilyVestedStaked" DECIMAL NOT NULL DEFAULT 0,
    "exchangeCustodyHoldings" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Price_symbol_priceTimestamp_idx" ON "Price"("symbol", "priceTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Price_symbol_priceTimestamp_source_key" ON "Price"("symbol", "priceTimestamp", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");
