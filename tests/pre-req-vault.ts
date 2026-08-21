import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PreReqVault } from "../target/types/pre_req_vault";
import {
  Commitment,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";

const COMMITMENT: Commitment = "confirmed";
const GITHUB_USERNAME: string = "jwmatheo";
const UPDATED_GITHUB_USERNAME: string = "jwmatheo-updated";
const STATE_SEED = Buffer.from("state");
const VAULT_SEED = Buffer.from("vault");
const APPLICATION_SEED = Buffer.from("prereqs");
const REGISTRATION_PROGRAM_ID = new PublicKey(
  "TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM"
);

const expectTransactionFailure = async (action: () => Promise<unknown>) => {
  let failed = false;

  try {
    await action();
  } catch (_error) {
    failed = true;
  }

  expect(failed).to.equal(true);
};

describe("pre-req-vault", () => {
  const confirmTx = async (signature: string) => {
    console.log(`Transaction signature: ${signature}`);
    const latestBlockhash = await anchor
      .getProvider()
      .connection.getLatestBlockhash();
    await anchor.getProvider().connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash,
      },
      COMMITMENT
    );
  };

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.preReqVault as Program<PreReqVault>;
  const user = provider.wallet.publicKey;

  // Derive PDAs

  const [vaultStatePda, stateBump] = PublicKey.findProgramAddressSync(
    [STATE_SEED, user.toBuffer()],
    program.programId
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, vaultStatePda.toBuffer()],
    program.programId
  );

  const applicationProgram = REGISTRATION_PROGRAM_ID;
  const [applicationAccount] = PublicKey.findProgramAddressSync(
    [APPLICATION_SEED, user.toBuffer()],
    applicationProgram
  );

  //   before(async () => {
  //     const sig = await provider.connection.requestAirdrop(
  //       user,
  //       10 * LAMPORTS_PER_SOL,
  //     );
  //     await confirmTx(sig);
  //   });

  it("Initialize the vault", async () => {
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.vaultBump).to.equal(vaultBump);
    expect(vaultState.stateBump).to.equal(stateBump);
  });

  it("Rejects a zero deposit", async () => {
    await expectTransactionFailure(() =>
      program.methods
        .deposit(new BN(0))
        .accountsStrict({
          user,
          vaultState: vaultStatePda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    );
  });

  it(" Deposilt 1 Sol in to the vault", async () => {
    const depositAmount = 1 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const intialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .deposit(new BN(depositAmount))
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(user);

    expect(finalBalanceVault).to.equal(initialVaultBalance + depositAmount);
    expect(finalBalanceUser).to.be.lessThan(intialUserBalance - depositAmount);
  });

  it("Rejects a zero withdrawal", async () => {
    await expectTransactionFailure(() =>
      program.methods
        .withdraw(new BN(0), GITHUB_USERNAME)
        .accountsStrict({
          user,
          vaultState: vaultStatePda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
          applicationAccount,
          applicationProgram,
        })
        .rpc()
    );
  });

  it(" Withdraw 0.5 Sol from the vault", async () => {
    const withdrawAmount = 0.5 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const intialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .withdraw(new BN(withdrawAmount), GITHUB_USERNAME)
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        applicationAccount,
        applicationProgram,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(user);

    expect(finalBalanceVault).to.equal(initialVaultBalance - withdrawAmount);
    expect(finalBalanceUser).to.be.greaterThan(intialUserBalance);
  });

  it("Withdraws again and updates the registration account", async () => {
    const withdrawAmount = 0.5 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const initialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .withdraw(new BN(withdrawAmount), UPDATED_GITHUB_USERNAME)
      .accountsStrict({
        user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        applicationAccount,
        applicationProgram,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const finalVaultBalance = await provider.connection.getBalance(vaultPda);
    const finalUserBalance = await provider.connection.getBalance(user);

    expect(finalVaultBalance).to.equal(initialVaultBalance - withdrawAmount);
    expect(finalUserBalance).to.be.greaterThan(initialUserBalance);
    expect(await provider.connection.getAccountInfo(applicationAccount)).to.not
      .be.null;
  });

  it(" Close the vault and withdraw all the funds", async () => {
    const initialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .close()
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        applicationAccount,
        applicationProgram,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    expect(await provider.connection.getBalance(vaultPda)).to.equal(0);

    const vaultStateInfo = await provider.connection.getAccountInfo(
      vaultStatePda
    );
    expect(vaultStateInfo).to.be.null;
    expect(await provider.connection.getAccountInfo(applicationAccount)).to.be
      .null;

    const finalUserBalance = await provider.connection.getBalance(user);
    expect(finalUserBalance).to.be.greaterThan(initialUserBalance);
  });
});
