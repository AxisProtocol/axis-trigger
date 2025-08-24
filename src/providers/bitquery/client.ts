
export interface BitqueryClientOptions {
  endpoint?: string;
  apiKey?: string;
}

export class BitqueryClient {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(options: BitqueryClientOptions = {}) {
    this.endpoint = options.endpoint || process.env.BITQUERY_ENDPOINT || "https://streaming.bitquery.io/graphql";
    const key = options.apiKey || process.env.BITQUERY_API_KEY || process.env.BITQUERY_TOKEN || process.env.BITQUERY_ACCESS_TOKEN;
    if (!key) {
      throw new Error("Missing Bitquery API key. Set BITQUERY_API_KEY.");
    }
    this.apiKey = key;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
        "Accept": "application/json",
        "User-Agent": "axis-trigger/0.1.0"
      },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch {}
      throw new Error(`Bitquery request failed: ${res.status} ${res.statusText} ${body}`);
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }>; };
    if (json.errors && json.errors.length) {
      const messages = json.errors.map(e => e.message).join("; ");
      throw new Error(`Bitquery GraphQL errors: ${messages}`);
    }
    if (!json.data) {
      throw new Error("Bitquery response missing data");
    }
    return json.data;
  }
}


