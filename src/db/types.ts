export type PrismaLike = {
  price: {
    findMany: (args: any) => Promise<Array<any>>;
    findFirst?: (args: any) => Promise<any | null>;
    createMany?: (args: any) => Promise<{ count: number }>;
  };
  waitlist: {
    findUnique: (args: any) => Promise<any | null>;
    findMany: (args: any) => Promise<Array<any>>;
    create: (args: any) => Promise<any>;
    count: (args?: any) => Promise<number>;
    groupBy: (args: any) => Promise<Array<any>>;
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

export type WaitlistRow = {
  id: string;
  email: string;
  consentMarketing: boolean;
  ipHash: string | null;
  userAgent: string | null;
  source: string | null;
  createdAt: Date;
  verifiedAt: Date | null;
};


