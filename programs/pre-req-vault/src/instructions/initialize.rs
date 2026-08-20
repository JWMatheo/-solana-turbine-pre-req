use crate::{
    constants::{STATE_SEED, VAULT_SEED},
    state::VaultState,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        seeds = [STATE_SEED, user.key().as_ref()],
        bump,
        space = 8 + VaultState::INIT_SPACE
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        seeds = [VAULT_SEED, vault_state.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl<'info> Initialize<'info> {
    pub fn initialize(&mut self, bumps: &InitializeBumps) -> Result<()> {
        // Save data to state
        self.vault_state.vault_bump = bumps.vault;
        self.vault_state.state_bump = bumps.vault_state;
        self.vault_state.has_withdrawn = false;

        Ok(())
    }
}
