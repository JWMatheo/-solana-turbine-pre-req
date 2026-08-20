use crate::{
    constants::{APPLICATION_SEED, MAX_GITHUB_USERNAME_LENGTH, STATE_SEED, VAULT_SEED},
    error::ErrorCode,
    external_programs::registration::{
        cpi::{accounts::Initialize, initialize},
        program::Q3PreReqsRs,
    },
    state::VaultState,
};
use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
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
    bump = vault_state.state_bump
  )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: application account will be initialized by the cpi call to the application program
    #[account(
    mut,
    seeds = [APPLICATION_SEED, user.key().as_ref()],
    seeds::program = application_program.key(),
    bump
    )]
    pub application_account: UncheckedAccount<'info>,

    pub application_program: Program<'info, Q3PreReqsRs>,

    system_program: Program<'info, System>,
}

impl<'info> Withdraw<'info> {
    pub fn withdraw(&mut self, amount: u64, github: String) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            amount <= self.vault.lamports(),
            ErrorCode::InsufficientVaultFunds
        );
        require!(!github.is_empty(), ErrorCode::InvalidGithubUsername);
        require!(
            github.len() <= MAX_GITHUB_USERNAME_LENGTH,
            ErrorCode::GithubUsernameTooLong
        );
        require!(
            github
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-'),
            ErrorCode::InvalidGithubUsername
        );

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

        transfer(cpi_ctx, amount)?;

        let registration_accounts = Initialize {
            user: self.user.to_account_info(),
            account: self.application_account.to_account_info(),
            system_program: self.system_program.to_account_info(),
        };

        let registration_ctx =
            CpiContext::new(self.application_program.key(), registration_accounts);

        initialize(registration_ctx, github)?;

        self.vault_state.has_withdrawn = true;

        Ok(())
    }
}
