export type PrismaLike = {
  price: {
    findMany: (args: any) => Promise<Array<any>>;
    findFirst?: (args: any) => Promise<any | null>;
    createMany?: (args: any) => Promise<{ count: number }>;
  };
  $queryRawUnsafe: <T = unknown>(...args: any[]) => Promise<T>;
  $disconnect?: () => Promise<void>;
};

// Helper type narrowing for handlers if needed in the future
export type PriceRow = {
  symbol: string;
  price: string | number;
  priceTimestamp: Date;
};


