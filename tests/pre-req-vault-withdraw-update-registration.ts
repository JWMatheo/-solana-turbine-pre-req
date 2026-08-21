import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PreReqVaultWithdrawUpdateRegistration } from "../target/types/pre_req_vault_withdraw_update_registration";
import {
  Commitment,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";

const COMMITMENT: Commitment = "confirmed";
const GITHUB_USERNAME = "jwmatheo";
const UPDATED_GITHUB_USERNAME = "jwmatheo-updated";
const STATE_SEED = Buffer.from("state");
const VAULT_SEED = Buffer.from("vault");
const APPLICATION_SEED = Buffer.from("prereqs");
const REGISTRATION_PROGRAM_ID = new PublicKey(
  "TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM"
);

const readStoredGithub = async (
  connection: ReturnType<typeof anchor.getProvider>["connection"],
  applicationAccount: PublicKey
) => {
  const accountInfo = await connection.getAccountInfo(applicationAccount);
  expect(accountInfo).to.not.equal(null);

  // discriminator (8) + user (32) + bump (1) + pre-req flags (2) + String.
  const githubLength = accountInfo!.data.readUInt32LE(43);
  return accountInfo!.data.subarray(47, 47 + githubLength).toString("utf8");
};

const hasRegistrationInstruction = (
  transaction: Awaited<
    ReturnType<
      ReturnType<typeof anchor.getProvider>["connection"]["getTransaction"]
    >
  >,
  instruction: string
) => {
  const logs = transaction?.meta?.logMessages ?? [];
  return (
    logs.some((log) =>
      log.includes(`Program ${REGISTRATION_PROGRAM_ID.toBase58()} invoke`)
    ) && logs.some((log) => log.includes(`Instruction: ${instruction}`))
  );
};

describe("pre-req-vault-withdraw-update-registration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .preReqVaultWithdrawUpdateRegistration as Program<PreReqVaultWithdrawUpdateRegistration>;
  const user = provider.wallet.publicKey;

  const confirmTx = async (signature: string) => {
    console.log(`Transaction signature: ${signature}`);
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      { signature, ...latestBlockhash },
      COMMITMENT
    );
  };

  const [vaultStatePda, stateBump] = PublicKey.findProgramAddressSync(
    [STATE_SEED, user.toBuffer()],
    program.programId
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, vaultStatePda.toBuffer()],
    program.programId
  );

  const [applicationAccount] = PublicKey.findProgramAddressSync(
    [APPLICATION_SEED, user.toBuffer()],
    REGISTRATION_PROGRAM_ID
  );

  it("initializes the vault", async () => {
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        user,
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

  it("deposits SOL", async () => {
    const tx = await program.methods
      .deposit(new BN(LAMPORTS_PER_SOL))
      .accountsStrict({
        user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);
    expect(await provider.connection.getBalance(vaultPda)).to.be.greaterThan(0);
  });

  it("initializes the registration account on the first withdrawal", async () => {
    const tx = await program.methods
      .withdraw(new BN(0.25 * LAMPORTS_PER_SOL), GITHUB_USERNAME)
      .accountsStrict({
        user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        applicationAccount,
        applicationProgram: REGISTRATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const transaction = await provider.connection.getTransaction(tx, {
      commitment: COMMITMENT,
      maxSupportedTransactionVersion: 0,
    });
    expect(transaction).to.not.equal(null);
    expect(hasRegistrationInstruction(transaction, "Initialize")).to.equal(
      true
    );
    expect(
      await readStoredGithub(provider.connection, applicationAccount)
    ).to.equal(GITHUB_USERNAME);
  });

  it("calls registration.update when the username changes", async () => {
    const tx = await program.methods
      .withdraw(new BN(0.25 * LAMPORTS_PER_SOL), UPDATED_GITHUB_USERNAME)
      .accountsStrict({
        user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        applicationAccount,
        applicationProgram: REGISTRATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const transaction = await provider.connection.getTransaction(tx, {
      commitment: COMMITMENT,
      maxSupportedTransactionVersion: 0,
    });
    expect(transaction).to.not.equal(null);
    expect(hasRegistrationInstruction(transaction, "Update")).to.equal(true);

    // The CPI succeeds, but the external account remains unchanged because
    // Registration::update receives a non-writable ApplicationAccount.
    expect(
      await readStoredGithub(provider.connection, applicationAccount)
    ).to.equal(GITHUB_USERNAME);
  });

  it("calls update again because the external username was not persisted", async () => {
    const tx = await program.methods
      .withdraw(new BN(0.25 * LAMPORTS_PER_SOL), UPDATED_GITHUB_USERNAME)
      .accountsStrict({
        user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        applicationAccount,
        applicationProgram: REGISTRATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const transaction = await provider.connection.getTransaction(tx, {
      commitment: COMMITMENT,
      maxSupportedTransactionVersion: 0,
    });
    expect(transaction).to.not.equal(null);
    expect(hasRegistrationInstruction(transaction, "Update")).to.equal(true);
    expect(
      await readStoredGithub(provider.connection, applicationAccount)
    ).to.equal(GITHUB_USERNAME);
  });

  it("closes the vault and the external application account", async () => {
    const tx = await program.methods
      .close()
      .accountsStrict({
        user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        applicationAccount,
        applicationProgram: REGISTRATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    expect(await provider.connection.getAccountInfo(vaultStatePda)).to.equal(
      null
    );
    expect(
      await provider.connection.getAccountInfo(applicationAccount)
    ).to.equal(null);
  });
});
