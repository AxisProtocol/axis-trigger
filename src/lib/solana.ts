import {
  Connection,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import bs58 from 'bs58';


// ----- Solana connection -----
export const connection = new Connection(
  `${process.env.SOLANA_RPC_URL}?api-key=${process.env.SOLANA_RPC_API_KEY}` || 'https://api.devnet.solana.com',
  'confirmed'
);

// ----- Treasury signer -----
let treasurySigner: Keypair | null = null;

export function loadTreasurySigner(): Keypair {
  if (!treasurySigner) {
    const privateKey = process.env.TREASURY_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('TREASURY_PRIVATE_KEY environment variable is required');
    }
    
    try {
      let keyArray: Uint8Array;
      
      // Handle array format (JSON array of numbers)
      if (privateKey.startsWith('[') && privateKey.endsWith(']')) {
        const parsedArray = JSON.parse(privateKey) as number[];
        if (!Array.isArray(parsedArray) || parsedArray.length !== 64) {
          throw new Error('Invalid private key array format: must be 64 numbers');
        }
        keyArray = new Uint8Array(parsedArray);
      } 
      // Handle base58 format
      else {
        const decoded = bs58.decode(privateKey);
        if (decoded.length !== 64) {
          throw new Error('Invalid private key length: must be 64 bytes');
        }
        keyArray = decoded;
      }
      
      treasurySigner = Keypair.fromSecretKey(keyArray);
    } catch (error) {
      throw new Error(`Failed to parse TREASURY_PRIVATE_KEY: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  return treasurySigner;
}

export const TREASURY_OWNER = process.env.TREASURY_OWNER 
  ? new PublicKey(process.env.TREASURY_OWNER) 
  : null;
