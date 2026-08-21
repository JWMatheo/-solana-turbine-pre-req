use crate::{
    constants::{APPLICATION_SEED, STATE_SEED, VAULT_SEED},
    events::VaultClosed,
    external_programs::registration::{
        cpi::{accounts::Close as RegistrationCloseAccounts, close as close_registration_account},
        program::Q3PreReqsRs,
    },
    state::VaultState,
};
use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, vault_state.key().as_ref()],
        bump = vault_state.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [STATE_SEED, user.key().as_ref()],
        bump = vault_state.state_bump,
        close = user,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: validated as the Registration Program PDA. The CPI is called only
    /// when the account is owned by the Registration Program and contains data.
    #[account(
        mut,
        seeds = [APPLICATION_SEED, user.key().as_ref()],
        seeds::program = application_program.key(),
        bump,
    )]
    pub application_account: UncheckedAccount<'info>,

    pub application_program: Program<'info, Q3PreReqsRs>,

    pub system_program: Program<'info, System>,
}

impl<'info> Close<'info> {
    pub fn close(&mut self) -> Result<()> {
        let application_program_id = self.application_program.key();
        let application_account = self.application_account.to_account_info();
        let should_close_application_account = application_account.owner == &application_program_id
            && !application_account.data_is_empty();

        if should_close_application_account {
            let registration_accounts = RegistrationCloseAccounts {
                user: self.user.to_account_info(),
                account: application_account,
                system_program: self.system_program.to_account_info(),
            };

            let registration_ctx =
                CpiContext::new(self.application_program.key(), registration_accounts);

            close_registration_account(registration_ctx)?;
        }

        let vault_lamports = self.vault.lamports();

        if vault_lamports > 0 {
            let cpi_accounts = Transfer {
                from: self.vault.to_account_info(),
                to: self.user.to_account_info(),
            };

            let seeds = &[
                VAULT_SEED,
                self.vault_state.to_account_info().key.as_ref(),
                &[self.vault_state.vault_bump],
            ];

            let signer_seeds = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(System::id(), cpi_accounts, signer_seeds);

            transfer(cpi_ctx, vault_lamports)?;
        }

        emit!(VaultClosed {
            user: self.user.key(),
            vault_state: self.vault_state.key(),
            vault: self.vault.key(),
            application_account: self.application_account.key(),
            vault_lamports,
        });

        Ok(())
    }
}
