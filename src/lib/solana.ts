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
      // Handle both base58 and array format
      let keyArray: number[];
      if (privateKey.startsWith('[') && privateKey.endsWith(']')) {
        keyArray = JSON.parse(privateKey);
      } else {
        // Assume base58 format
        keyArray = Array.from(bs58.decode(privateKey));
      }
      
      treasurySigner = Keypair.fromSecretKey(new Uint8Array(keyArray));
    } catch (error) {
      throw new Error(`Failed to parse TREASURY_PRIVATE_KEY: ${error}`);
    }
  }
  
  return treasurySigner;
}

export const TREASURY_OWNER = process.env.TREASURY_OWNER 
  ? new PublicKey(process.env.TREASURY_OWNER) 
  : null;
