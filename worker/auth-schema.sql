CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY NOT NULL,
    verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviewer_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    github_id TEXT NOT NULL,
    github_login TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
