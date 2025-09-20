import { PublicKey, ComputeBudgetProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { connection, loadTreasurySigner, TREASURY_OWNER } from './solana'
import { putPending, markPaid, markFailed } from './settlementStore'
import type { PrismaLike } from '../db/types'

function safePk(raw?: string | null): PublicKey | null {
  try { 
    const v = (raw || '').trim(); 
    if (!v) return null; 
    return new PublicKey(v) 
  } catch { 
    return null 
  }
}

const USDC_DEV_MINT = safePk(process.env.USDC_DEV_MINT)
const TREASURY_USDC_ATA = safePk(process.env.TREASURY_USDC_ATA)
const AXIS_MINT_2022 = safePk(process.env.AXIS_MINT_2022)
const AXIS_DEC = parseInt(process.env.AXIS_DECIMALS || '9', 10)

const L = (o: any) => console.log(JSON.stringify({ ts: new Date().toISOString(), mod: 'settlement-processor', ...o }))

export async function fetchIndexValue(c: any): Promise<number> {
  const { loadAssetsFromBundledConfig, loadAssetsFromEnv } = await import('../providers/envAssets')
  const { loadAssetFreeFloats } = await import('../utils/indexSeries')
  const { loadAppConfig } = await import('../config')

  const cfg = loadAppConfig()
  const assets = cfg.assetConfigFilePath ? loadAssetsFromBundledConfig() : loadAssetsFromEnv()
  if (assets.length === 0) throw new Error('no assets configured')

  const { freeFloatBySymbol } = await loadAssetFreeFloats()
  const symbols = assets.map(a => a.symbol)
  
  // 使用 c.get("prisma") 獲取 prisma 實例
  const prisma = c.get("prisma")
  if (!prisma) throw new Error('Database connection not available')

  const [latestPrices, basePrices] = await Promise.all([
    (prisma as any).price.findMany({
      where: {
        symbol: { in: symbols }
      },
      orderBy: { priceTimestamp: 'desc' },
      select: { symbol: true, price: true },
      distinct: ['symbol'] 
    }),
    (prisma as any).price.findMany({
      where: {
        symbol: { in: symbols }
      },
      orderBy: { priceTimestamp: 'asc' },
      select: { symbol: true, price: true },
      distinct: ['symbol'] // 確保每個符號只返回一條記錄
    })
  ])

  const latestBySymbol = new Map<string, number>()
  const baseBySymbol = new Map<string, number>()

  latestPrices.forEach((r: any) => {
    if (r) latestBySymbol.set(r.symbol, Number(r.price))
  })

  basePrices.forEach((r: any) => {
    if (r) baseBySymbol.set(r.symbol, Number(r.price))
  })

  const present = symbols.filter(s => 
    latestBySymbol.has(s) && baseBySymbol.has(s) && freeFloatBySymbol.has(s)
  )

  if (present.length === 0) throw new Error('no prices available')

  let baseIndex = 0
  let currentIndex = 0
  
  for (const s of present) {
    const ff = freeFloatBySymbol.get(s) || 0
    const pBase = baseBySymbol.get(s) as number
    const pNow = latestBySymbol.get(s) as number
    baseIndex += ff * pBase
    currentIndex += ff * pNow
  }

  if (baseIndex === 0) throw new Error('baseline index is zero')
  
  return 100 * (currentIndex / baseIndex)
}

async function transferAxisToUser(userOwner: PublicKey, axisUiAmount: number) {
  if (!connection) throw new Error('Solana connection not available')
  if (!TREASURY_OWNER) throw new Error('TREASURY_OWNER not available')
  if (!AXIS_MINT_2022) throw new Error('AXIS_MINT_2022 not available')
  
  const signer = loadTreasurySigner()
  const src = (await getOrCreateAssociatedTokenAccount(
    connection, signer, AXIS_MINT_2022, TREASURY_OWNER, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID
  )).address
  const dst = (await getOrCreateAssociatedTokenAccount(
    connection, signer, AXIS_MINT_2022, userOwner, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID
  )).address
  
  const amount = BigInt(Math.floor(axisUiAmount * 10 ** AXIS_DEC))
  const ix = createTransferCheckedInstruction(
    src, AXIS_MINT_2022, dst, signer.publicKey, amount, AXIS_DEC, [], TOKEN_2022_PROGRAM_ID
  )
  
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
    ix
  )
  tx.feePayer = signer.publicKey
  
  return await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'finalized' })
}

async function transferUsdcToUser(userOwner: PublicKey, usdcUiAmount: number) {
  if (!connection) throw new Error('Solana connection not available')
  if (!TREASURY_USDC_ATA) throw new Error('TREASURY_USDC_ATA not available')
  if (!USDC_DEV_MINT) throw new Error('USDC_DEV_MINT not available')
  
  const signer = loadTreasurySigner()
  const src = TREASURY_USDC_ATA
  const dst = (await getOrCreateAssociatedTokenAccount(
    connection, signer, USDC_DEV_MINT, userOwner
  )).address
  
  const amount = BigInt(Math.floor(usdcUiAmount * 10 ** 6))
  const ix = createTransferCheckedInstruction(
    src, USDC_DEV_MINT, dst, signer.publicKey, amount, 6
  )
  
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
    ix
  )
  tx.feePayer = signer.publicKey
  
  return await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'finalized' })
}

export async function verifyUsdcDepositOnChain(signature: string): Promise<{ fromUser: PublicKey, uiAmount: number } | null> {
  if (!connection || !TREASURY_USDC_ATA || !USDC_DEV_MINT) return null
  
  try {
    const tx = await connection.getTransaction(signature, { 
      commitment: 'confirmed', // Use confirmed instead of finalized for faster response
      maxSupportedTransactionVersion: 0 
    } as any)
    
    if (!tx?.meta) return null
    
    const keys = tx.transaction.message.getAccountKeys()
    const pre = tx.meta.preTokenBalances || []
    const post = tx.meta.postTokenBalances || []
    
    const findPubkeyByIndex = (idx: number) => { 
      try { 
        return keys.get(idx) as PublicKey 
      } catch { 
        return null 
      } 
    }
    
    const postTreasury = post.find(b => 
      b.mint === USDC_DEV_MINT.toBase58() && 
      findPubkeyByIndex(b.accountIndex)?.equals(TREASURY_USDC_ATA)
    )
    
    if (!postTreasury) return null
    
    const preTreasury = pre.find(b => 
      b.mint === USDC_DEV_MINT.toBase58() && 
      b.accountIndex === postTreasury.accountIndex
    ) || { uiTokenAmount: { uiAmount: 0 } as any }
    
    const postAmt = Number(postTreasury.uiTokenAmount?.uiAmount || 0)
    const preAmt = Number((preTreasury as any)?.uiTokenAmount?.uiAmount || 0)
    const delta = postAmt - preAmt
    
    if (!(delta > 0)) return null
    
    let senderEntry: { pb: any, change: number } | null = null
    for (const pb of post) {
      if (pb.mint !== USDC_DEV_MINT.toBase58()) continue
      const preb = pre.find(x => x.accountIndex === pb.accountIndex)
      const pAmt = Number(preb?.uiTokenAmount?.uiAmount || 0)
      const qAmt = Number(pb.uiTokenAmount?.uiAmount || 0)
      const change = qAmt - pAmt
      if (change < 0 && (!senderEntry || change < senderEntry.change)) {
        senderEntry = { pb, change }
      }
    }
    
    const senderEntryFinal = senderEntry
    if (!senderEntryFinal) return null
    
    const ownerStr: string | undefined = senderEntryFinal.pb.owner
    if (!ownerStr) return null
    
    return { fromUser: new PublicKey(ownerStr), uiAmount: delta }
  } catch (error) {
    // Log error but don't throw - let the calling function handle it
    console.warn(`Failed to verify USDC deposit for signature ${signature}:`, error);
    return null;
  }
}

export async function verifyAxisDepositOnChain(signature: string): Promise<{ fromUser: PublicKey, uiAmount: number } | null> {
  if (!connection || !AXIS_MINT_2022 || !TREASURY_OWNER) return null
  
  try {
    const tx = await connection.getTransaction(signature, { 
      commitment: 'confirmed', // Use confirmed instead of finalized for faster response
      maxSupportedTransactionVersion: 0 
    } as any)
    
    if (!tx?.meta) return null
    
    const keys = tx.transaction.message.getAccountKeys()
    const pre = tx.meta.preTokenBalances || []
    const post = tx.meta.postTokenBalances || []
    
    const findPubkeyByIndex = (idx: number) => { 
      try { 
        return keys.get(idx) as PublicKey 
      } catch { 
        return null 
      } 
    }
    
    const treasuryOwnerStr = TREASURY_OWNER!.toBase58()
    const postTreasuryAxis = post.find(b => 
      b.mint === AXIS_MINT_2022.toBase58() && 
      b.owner === treasuryOwnerStr
    )
    
    if (!postTreasuryAxis) return null
    
    const preTreasuryAxis = pre.find(b => 
      b.mint === AXIS_MINT_2022.toBase58() && 
      b.accountIndex === postTreasuryAxis.accountIndex
    ) || { uiTokenAmount: { uiAmount: 0 } as any }
    
    const postAmt = Number(postTreasuryAxis.uiTokenAmount?.uiAmount || 0)
    const preAmt = Number((preTreasuryAxis as any)?.uiTokenAmount?.uiAmount || 0)
    const delta = postAmt - preAmt
    
    if (!(delta > 0)) return null
    
    let senderEntry: { pb: any, change: number } | null = null
    for (const pb of post) {
      if (pb.mint !== AXIS_MINT_2022.toBase58()) continue
      const preb = pre.find(x => x.accountIndex === pb.accountIndex)
      const pAmt = Number(preb?.uiTokenAmount?.uiAmount || 0)
      const qAmt = Number(pb.uiTokenAmount?.uiAmount || 0)
      const change = qAmt - pAmt
      if (change < 0 && (!senderEntry || change < senderEntry.change)) {
        senderEntry = { pb, change }
      }
    }
    
    const senderEntryFinal = senderEntry
    if (!senderEntryFinal) return null
    
    const fromOwner = senderEntryFinal.pb.owner
    if (!fromOwner) return null
    
    return { fromUser: new PublicKey(fromOwner), uiAmount: delta }
  } catch (error) {
    // Log error but don't throw - let the calling function handle it
    console.warn(`Failed to verify AXIS deposit for signature ${signature}:`, error);
    return null;
  }
}

export async function processDepositSignature(c: any, signature: string) {
  L({ lvl: 'info', step: 'process.begin', signature })
  
  try {
    // 並行執行驗證和價格獲取
    const [verUSDC, verAXIS, indexValue] = await Promise.all([
      verifyUsdcDepositOnChain(signature),
      verifyAxisDepositOnChain(signature),
      fetchIndexValue(c)
    ])

    if (verUSDC) {
      const axisToSend = verUSDC.uiAmount / indexValue
      const sendSig = await transferAxisToUser(verUSDC.fromUser, axisToSend)
      await markPaid(c, signature, { 
        axisUi: axisToSend, 
        indexValue, 
        payoutSig: sendSig 
      })
      return { 
        side: 'mint' as const, 
        indexValue, 
        payoutSig: sendSig, 
        axisUi: axisToSend 
      }
    }
    
    if (verAXIS) {
      const usdcToSend = verAXIS.uiAmount * indexValue
      const sendSig = await transferUsdcToUser(verAXIS.fromUser, usdcToSend)
      await markPaid(c, signature, { 
        usdcUi: usdcToSend, 
        indexValue, 
        payoutSig: sendSig 
      })
      return { 
        side: 'burn' as const, 
        indexValue, 
        payoutSig: sendSig, 
        usdcUi: usdcToSend 
      }
    }
    
    throw new Error('Signature does not match mint or burn deposit')
  } catch (e: any) {
    L({ lvl: 'error', step: 'process.fail', signature, err: e?.message })
    await markFailed(c, signature, e?.message || String(e))
    throw e
  }
}

export type DepositClassification =
  | { kind: 'mint', fromUser: PublicKey, uiAmount: number }
  | { kind: 'burn', fromUser: PublicKey, uiAmount: number }
  | null

export async function classifyDeposit(signature: string): Promise<DepositClassification> {
  const mint = await verifyUsdcDepositOnChain(signature)
  if (mint) return { kind: 'mint', fromUser: mint.fromUser, uiAmount: mint.uiAmount }
  
  const burn = await verifyAxisDepositOnChain(signature)
  if (burn) return { kind: 'burn', fromUser: burn.fromUser, uiAmount: burn.uiAmount }
  
  return null
}

export async function getPayoutPlan(c: any, signature: string): Promise<
  | { side: 'mint', axisUi: number, indexValue: number, fromUser: string }
  | { side: 'burn', usdcUi: number, indexValue: number, fromUser: string }
> {
  const cls = await classifyDeposit(signature)
  if (!cls) throw new Error('Signature does not match mint or burn deposit')
  
  const indexValue = await fetchIndexValue(c)
  
  if (cls.kind === 'mint') {
    const axisUi = cls.uiAmount / indexValue
    return { side: 'mint', axisUi, indexValue, fromUser: cls.fromUser.toBase58() }
  } else {
    const usdcUi = cls.uiAmount * indexValue
    return { side: 'burn', usdcUi, indexValue, fromUser: cls.fromUser.toBase58() }
  }
}

export async function payoutForSignature(c: any, signature: string) {
  const cls = await classifyDeposit(signature)
  if (!cls) throw new Error('Signature does not match mint or burn deposit')
  
  const indexValue = await fetchIndexValue(c)
  
  if (cls.kind === 'mint') {
    const axisUi = cls.uiAmount / indexValue
    const sendSig = await transferAxisToUser(cls.fromUser, axisUi)
    await markPaid(c, signature, { 
      axisUi, 
      indexValue, 
      payoutSig: String(sendSig) 
    })
    return { 
      side: 'mint' as const, 
      payoutSig: String(sendSig), 
      axisUi, 
      indexValue 
    }
  } else {
    const usdcUi = cls.uiAmount * indexValue
    const sendSig = await transferUsdcToUser(cls.fromUser, usdcUi)
    await markPaid(c, signature, { 
      usdcUi, 
      indexValue, 
      payoutSig: String(sendSig) 
    })
    return { 
      side: 'burn' as const, 
      payoutSig: String(sendSig), 
      usdcUi, 
      indexValue 
    }
  }
}