// src/stellar/stellar.service.ts
import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StellarSdk from 'stellar-sdk';
import { CreateStellarDto } from './dto/create-stellar.dto';
import { UpdateStellarDto } from './dto/update-stellar.dto';

export interface PaymentResult {
  stellarTxHash: string;
  amount: string;
  destination: string;
}

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private server: InstanceType<typeof StellarSdk.Horizon.Server>;

  constructor(private readonly configService: ConfigService) {
    const network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const horizonUrl =
      network === 'mainnet'
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org';
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
  }

  /**
   * Sign and submit a native XLM payment from the treasury account to the
   * destination address. Returns the confirmed Stellar transaction hash.
   *
   * The treasury secret is read from config at call time and is never logged
   * or persisted.
   */
  async sendPayment(destination: string, amountXlm: number): Promise<PaymentResult> {
    const secretKey = this.configService.get<string>('STELLAR_TREASURY_SECRET_KEY');
    if (!secretKey) {
      throw new Error('STELLAR_TREASURY_SECRET_KEY is not configured');
    }

    const network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const passphrase =
      network === 'mainnet'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;

    const sourceKeypair = StellarSdk.Keypair.fromSecret(secretKey);
    const sourcePublic = sourceKeypair.publicKey();

    const sourceAccount = await this.server.loadAccount(sourcePublic);

    const amountStr = amountXlm.toFixed(7);

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: await this.server.fetchBaseFee(),
      networkPassphrase: passphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: amountStr,
        }),
      )
      .addMemo(StellarSdk.Memo.text('VitaStellar reward'))
      .setTimeout(StellarSdk.TimeoutInfinite)
      .build();

    transaction.sign(sourceKeypair);

    const result = await this.server.submitTransaction(transaction);

    const txHash = result.hash;
    this.logger.log(
      `Stellar payment submitted: ${amountStr} XLM to ${destination} (tx: ${txHash})`,
    );

    return {
      stellarTxHash: txHash,
      amount: amountStr,
      destination,
    };
  }

  async accountExists(address: string): Promise<boolean> {
    try {
      await this.server.accounts().accountId(address).call();
      return true;
    } catch {
      return false;
    }
  }

  async getAccountBalance(address: string): Promise<string> {
    try {
      const account = await this.server.accounts().accountId(address).call();
      const xlmBalance = account.balances.find((balance) => balance.asset_type === 'native');
      return xlmBalance ? xlmBalance.balance : '0';
    } catch (error) {
      throw new Error('Unable to fetch account balance');
    }
  }

  async create(_createStellarDto: CreateStellarDto): Promise<never> {
    throw new NotImplementedException('Stellar CRUD operations are not yet implemented');
  }

  async findAll(): Promise<never> {
    throw new NotImplementedException('Stellar CRUD operations are not yet implemented');
  }

  async findOne(_id: number): Promise<never> {
    throw new NotImplementedException('Stellar CRUD operations are not yet implemented');
  }

  async update(_id: number, _updateStellarDto: UpdateStellarDto): Promise<never> {
    throw new NotImplementedException('Stellar CRUD operations are not yet implemented');
  }

  async remove(_id: number): Promise<never> {
    throw new NotImplementedException('Stellar CRUD operations are not yet implemented');
  }
}
