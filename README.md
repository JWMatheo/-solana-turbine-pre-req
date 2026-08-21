# Pre-Req Vault

An Anchor vault program on Solana. Users can initialize a personal vault, deposit SOL, withdraw SOL while registering their GitHub username in an external Registration Program, and close the vault.

## Improvements delivered

This iteration focuses on making the vault lifecycle complete, safer, observable, and reliable to test. The most important improvements are:

| Improvement                 | What changed                                                                                                                       | Value                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Complete PDA cleanup        | `close` performs a CPI to the Registration Program to close the external `ApplicationAccount` PDA.                                 | Closing the vault no longer leaves Registration Program state behind.      |
| Multiple withdrawals        | The first `withdraw` calls `registration.initialize`; later withdrawals call `registration.update` only when the username changes. | Users can withdraw more than once without sending redundant CPIs.          |
| Correct CPI mutability      | The Registration IDL marks `update.account` as writable.                                                                           | The external update CPI can modify the registration account correctly.     |
| Input validation and errors | Added checks for positive amounts, available funds, and valid GitHub usernames, with explicit `ErrorCode` variants.                | Invalid requests fail before SOL transfers or CPIs occur.                  |
| Real constant usage         | PDA seed bytes and the GitHub username limit are centralized in [`constants.rs`](programs/pre-req-vault/src/constants.rs).         | PDA derivation and validation rules remain consistent across instructions. |
| Lifecycle events            | Added `VaultInitialized`, `Deposited`, `Withdrawn`, and `VaultClosed`.                                                             | Clients and indexers can observe the complete vault lifecycle.             |
| Reliable TypeScript tests   | Every transaction is awaited through `confirmTx` before balances or account state are read.                                        | Assertions do not race the validator or RPC and read stale state.          |

The Registration IDL is loaded by [`external_programs.rs`](programs/pre-req-vault/src/external_programs.rs), and [`build.rs`](programs/pre-req-vault/build.rs) tracks changes to [`idls/registration.json`](idls/registration.json).

## Program IDs

- Vault program: `5BrvmKW8LxW5VJ5gfJtrjPp6rYT8weM9uGwjNNH3B1ja`
- Registration Program: `TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM`
- Cluster used for testing: Solana Devnet

## Architecture

The vault uses three deterministic accounts:

| Account              | Seeds                    | Owner                | Purpose                                                        |
| -------------------- | ------------------------ | -------------------- | -------------------------------------------------------------- |
| `VaultState`         | `["state", user]`        | Vault Program        | Stores the vault and state bumps                               |
| Vault PDA            | `["vault", vault_state]` | System Program       | Holds the user's SOL                                           |
| `ApplicationAccount` | `["prereqs", user]`      | Registration Program | Stores the user's registration data, including GitHub username |

`initialize` creates only `VaultState`. The Vault PDA is derived and validated at that point, but it is created/funded lazily by the first `deposit` through a System Program transfer.

## Instruction flow

### `initialize`

- Creates the user's `VaultState` PDA.
- Stores the vault and state bumps.
- Emits `VaultInitialized`.
- Calling `initialize` twice for the same user fails because the `VaultState` PDA already exists.

### `deposit(amount)`

- Requires an existing `VaultState`.
- Rejects an amount of zero.
- Transfers SOL from the user to the Vault PDA through the System Program.
- Emits `Deposited`.

### `withdraw(amount, github)`

- Validates that the amount is positive and does not exceed the vault balance.
- Validates the GitHub username: it must be non-empty, at most 39 characters, and contain only ASCII letters, numbers, or `-`.
- Transfers SOL from the Vault PDA to the user with PDA signer seeds.
- Checks whether the `ApplicationAccount` already exists:
  - If it does not exist, it performs a CPI to `registration.initialize`.
  - If it exists and is owned by the Registration Program, it decodes the stored username.
  - If the username changed, it performs a CPI to `registration.update`.
  - If the username is unchanged, it skips the Registration Program CPI entirely.
- This allows multiple withdrawals during the same vault lifecycle.
- Emits `Withdrawn`.

### `close`

- Requires an existing `VaultState`.
- Closes the `ApplicationAccount` only when it is owned by the Registration Program and contains data.
- Transfers the remaining vault lamports to the user when the vault has funds.
- Closes `VaultState` and returns its rent to the user through Anchor's `close = user` constraint.
- Emits `VaultClosed`.

The Registration Program CPI is important because the vault program does not own the
`ApplicationAccount` PDA. Calling the external `close` instruction ensures that this
second program-owned account is also closed instead of being left on-chain after the
vault is closed.

The instruction works in all of these cases:

- `initialize` without a deposit;
- `initialize` followed by a deposit but no withdrawal;
- one or more withdrawals followed by `close`.

## Tests

Build the program:

```bash
anchor build
```

Run the Devnet integration tests with a funded test wallet:

```bash
anchor test \
  --provider.wallet /path/to/test-wallet.json \
  --provider.cluster devnet \
  --skip-deploy \
  --skip-local-validator
```

The TypeScript suite covers initialization, invalid deposits and withdrawals, multiple withdrawals, skipping an unnecessary registration CPI when the username is unchanged, and closing the vault.

Additional local checks:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
pnpm exec tsc --noEmit
```

## Source layout

- [`programs/pre-req-vault/src/lib.rs`](programs/pre-req-vault/src/lib.rs): public instructions and program ID.
- [`programs/pre-req-vault/src/instructions`](programs/pre-req-vault/src/instructions): instruction account constraints and handlers.
- [`programs/pre-req-vault/src/state.rs`](programs/pre-req-vault/src/state.rs): on-chain `VaultState` account.
- [`programs/pre-req-vault/src/events.rs`](programs/pre-req-vault/src/events.rs): emitted lifecycle events.
- [`programs/pre-req-vault/src/external_programs.rs`](programs/pre-req-vault/src/external_programs.rs): generated Registration Program interface.
- [`tests/pre-req-vault.ts`](tests/pre-req-vault.ts): Devnet integration tests.
