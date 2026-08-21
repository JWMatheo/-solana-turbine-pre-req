pub mod constants;
pub mod error;
pub mod events;
pub mod external_programs;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

// This variant has its own local program keypair. It is not deployed yet.
declare_id!("HQD2ACc2xShPK3UbecZNG5PZcWtv6JNkCE2mmyAtsKoY");

#[program]
pub mod pre_req_vault_withdraw_update_registration {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.initialize(&ctx.bumps)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        ctx.accounts.deposit(amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64, github: String) -> Result<()> {
        ctx.accounts.withdraw(amount, github)
    }

    pub fn close(ctx: Context<Close>) -> Result<()> {
        ctx.accounts.close()
    }
}
