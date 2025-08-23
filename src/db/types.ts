export type PrismaLike = {
  price: {
    findMany: (args: any) => Promise<Array<any>>;
  };
  $queryRawUnsafe: <T = unknown>(...args: any[]) => Promise<T>;
  $disconnect?: () => Promise<void>;
};


