use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be more than 0")]
    InvalidAmount,
    #[msg("Amount must be less than current vault value")]
    InsufficientVaultFunds,
    #[msg("The GitHub username cannot be empty")]
    InvalidGithubUsername,
    #[msg("The GitHub username is too long")]
    GithubUsernameTooLong,
    #[msg("The vault can only be closed after a withdrawal")]
    WithdrawalRequiredBeforeClose,
}
