# Pre-Req Vault

This repository contains two versions of the same Anchor vault architecture.
The distinction is intentional: one version is the reliable implementation,
and the other preserves an experimental conditional CPI so the Registration
Program limitation is visible in code and tests.

## Start here: the two vault programs

### `pre-req-vault` — stable implementation

This is the version to use and present as the working vault program.

On `withdraw` it:

1. Transfers SOL from the vault PDA to the user.
2. Calls `registration.initialize(github)` only when the external
   `ApplicationAccount` does not exist yet.
3. Does not call `registration.update` for later withdrawals.

The last point is deliberate. The deployed Registration Program exposes an
`update` instruction whose `account` is not writable in its deployed IDL.
Calling that CPI succeeds, but the
external `ApplicationAccount.github` value remains unchanged. The stable vault
therefore does not rely on an update that cannot persist state.

The deployed stable program is:

```text
5BrvmKW8LxW5VJ5gfJtrjPp6rYT8weM9uGwjNNH3B1ja
```

### `pre-req-vault-withdraw-update-registration` — conditional-update variant

This program preserves the current conditional implementation as a separate
demonstration. Its `withdraw` instruction:

1. Reads the external `ApplicationAccount` when it already exists.
2. Calls `registration.initialize` for a new account.
3. Calls `registration.update` only when the requested GitHub username differs
   from the stored value.

This is a useful implementation pattern when the external account is writable.
With the Registration Program deployed for this task, however, the account is
read-only for `update`. The CPI can be invoked, but it cannot update the
`github` field. This variant makes that limitation explicit; it is not the
stable implementation.

The variant has its own local program ID, but it is not deployed yet:

```text
HQD2ACc2xShPK3UbecZNG5PZcWtv6JNkCE2mmyAtsKoY
```

## Improvements delivered in `pre-req-vault`

The improvements below belong to the stable `pre-req-vault` program. The
conditional-update variant is kept separately so it does not change the
working implementation.

| Improvement                   | Implementation                                                                                                                                                                          | Value                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Complete PDA cleanup          | `close` performs a CPI to the Registration Program to close the external `ApplicationAccount`, forwarding the user as a writable signer, then drains the vault and closes `VaultState`. | All accounts involved in the vault lifecycle are cleaned up.                                 |
| Multiple withdrawals          | Later withdrawals transfer SOL without attempting the unsupported Registration `update`.                                                                                                | A user can withdraw multiple times without depending on a non-mutating CPI.                  |
| Input validation              | Amounts must be positive, withdrawals cannot exceed the vault balance, and GitHub usernames must be valid ASCII values within the configured limit.                                     | Invalid requests fail before the intended state transition completes.                        |
| Real constants                | PDA seed bytes and the maximum GitHub username length are centralized in [`constants.rs`](programs/pre-req-vault/src/constants.rs).                                                     | PDA derivation and validation rules stay consistent.                                         |
| Lifecycle events              | `VaultInitialized`, `Deposited`, `Withdrawn`, and `VaultClosed` are emitted.                                                                                                            | Clients and indexers can observe the vault lifecycle.                                        |
| Reliable TypeScript tests     | Transaction confirmation is awaited before balances, logs, or account data are asserted.                                                                                                | Tests do not race RPC or validator state.                                                    |
| External-program verification | The Registration IDL used for code generation records that `update.account` is not writable.                                                                                            | The CPI account mutability assumptions are explicit and match the deployed external program. |

## Architecture

Both vault programs use the same account topology:

| Account              | Seeds                    | Owner                | Purpose                                                               |
| -------------------- | ------------------------ | -------------------- | --------------------------------------------------------------------- |
| `VaultState`         | `["state", user]`        | Vault program        | Stores the vault and state bumps.                                     |
| Vault PDA            | `["vault", vault_state]` | System Program       | Holds the user's SOL.                                                 |
| `ApplicationAccount` | `["prereqs", user]`      | Registration Program | Stores the external registration data, including the GitHub username. |

`initialize` creates only `VaultState`. The vault PDA is derived and validated,
then receives its first lamports through `deposit`.

## Stable instruction flow

### `initialize`

- Creates the user's `VaultState` PDA.
- Stores the vault and state bumps.
- Emits `VaultInitialized`.
- A second call for the same user fails because the PDA already exists.

### `deposit(amount)`

- Requires an existing `VaultState`.
- Rejects zero.
- Transfers SOL from the user to the vault PDA through the System Program.
- Emits `Deposited`.

### `withdraw(amount, github)`

- Validates the amount and GitHub username.
- Transfers SOL from the vault PDA to the user using the vault PDA signer seeds.
- Initializes the external `ApplicationAccount` only on the first withdrawal.
- Leaves the external username unchanged on later withdrawals because the
  deployed Registration `update` cannot write that account.
- Emits `Withdrawn`.

### `close`

- Closes the external `ApplicationAccount` through the Registration Program
  when it exists. The CPI forwards `user` as both writable and signer because
  the Registration Program requires the user to authorize the close.
- Transfers remaining vault lamports to the user.
- Closes `VaultState` through Anchor's `close = user` constraint.
- Emits `VaultClosed`.

## Why the conditional variant exists

The conditional implementation is in
[`pre-req-vault-withdraw-update-registration`](programs/pre-req-vault-withdraw-update-registration/src/instructions/withdraw.rs).
It demonstrates the natural design when an external registration account is
mutable:

```text
ApplicationAccount absent   -> registration.initialize(github)
ApplicationAccount exists   -> compare stored github
Username changed            -> registration.update(github)
Username unchanged          -> skip update
```

For this deployed Registration Program, the downloaded IDL describes
`update.account` without `writable: true`. The account is therefore not a
valid writable target for an update. The Devnet test showed that the CPI logs
`Instruction: Update`, but the stored value remained the old username. The
stable program intentionally avoids this unsupported branch.

The variant is also compiled against
[`idls/registration_withdraw_update.json`](idls/registration_withdraw_update.json),
a diagnostic copy that marks `update.account` as writable. This changes the
CPI metadata generated for the variant only; it cannot change the already
deployed Registration Program. The variant uses
`declare_program!(registration_withdraw_update)`, so Anchor resolves this
underscore-named IDL directly.

## External Registration IDL

[`idls/registration.json`](idls/registration.json) is the formatted IDL used
by Anchor's `declare_program!(registration)` macro. It records the deployed
Registration Program definition on the relevant fields:

- Program address: `TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM`.
- `update` takes a `github: string` argument.
- `update.account` is not writable.
- `ApplicationAccount` contains `user`, `bump`, `pre_req_ts`, `pre_req_rs`,
  and `github`.
- `close` can close the external application account, and its `user` account
  must be both writable and a signer. Without `signer: true` in this local IDL,
  the CPI reaches the Registration Program but fails with `AccountNotSigner`.

The conditional-update variant uses the separate
[`idls/registration_withdraw_update.json`](idls/registration_withdraw_update.json)
only to test the writable-CPI hypothesis.

The [`build.rs`](programs/pre-req-vault/build.rs) files track the external IDL
so changes trigger a rebuild.

## Tests and checks

Build both workspace programs:

```bash
anchor build
```

Run the stable Devnet integration tests with a funded test wallet:

```bash
anchor test \
  --provider.wallet /path/to/test-wallet.json \
  --provider.cluster devnet \
  --skip-deploy \
  --skip-local-validator
```

The TypeScript suite covers initialization, invalid deposits and withdrawals,
multiple withdrawals without an unsupported Registration update, and complete
closure of the vault and external application account.

The conditional-update tests are kept in a separate suite so the stable test
does not depend on the experimental program. After deploying the variant with
its dedicated keypair, run the suite with a fresh test wallet so the
`ApplicationAccount` starts uninitialized:

```bash
ANCHOR_WALLET=/path/to/test-wallet.json \
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
anchor run test_withdraw_update_registration
```

That suite asserts that the second withdrawal invokes `registration.update`,
that the stored username remains unchanged, and that a later withdrawal calls
`update` again because the previous update was not persisted.

The Devnet program `5BrvmKW8LxW5VJ5gfJtrjPp6rYT8weM9uGwjNNH3B1ja` still contains
the previously deployed binary until it is explicitly upgraded. The stable
test suite describes the new source behavior, so deploy the stable program
before running that suite against Devnet.

Additional local checks:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
pnpm exec tsc --noEmit
pnpm exec prettier README.md idls/registration.json tests/*.ts --check
```

## Source layout

Stable program:

- [`programs/pre-req-vault/src/lib.rs`](programs/pre-req-vault/src/lib.rs): program ID and public instructions.
- [`programs/pre-req-vault/src/instructions`](programs/pre-req-vault/src/instructions): account constraints and handlers.
- [`programs/pre-req-vault/src/state.rs`](programs/pre-req-vault/src/state.rs): persistent `VaultState` schema.
- [`programs/pre-req-vault/src/events.rs`](programs/pre-req-vault/src/events.rs): lifecycle events.
- [`programs/pre-req-vault/src/external_programs.rs`](programs/pre-req-vault/src/external_programs.rs): generated Registration interface.
- [`tests/pre-req-vault.ts`](tests/pre-req-vault.ts): stable Devnet integration tests.

Conditional-update variant:

- [`programs/pre-req-vault-withdraw-update-registration/src/lib.rs`](programs/pre-req-vault-withdraw-update-registration/src/lib.rs): separate demonstration program entry point.
- [`programs/pre-req-vault-withdraw-update-registration/src/instructions/withdraw.rs`](programs/pre-req-vault-withdraw-update-registration/src/instructions/withdraw.rs): conditional Registration `update` implementation.
- [`tests/pre-req-vault-withdraw-update-registration.ts`](tests/pre-req-vault-withdraw-update-registration.ts): tests exercising whether the conditional CPI persists the username when the account is sent as writable.
