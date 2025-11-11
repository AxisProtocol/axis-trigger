-- Create Waitlist table
CREATE TABLE IF NOT EXISTS Waitlist (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  consentMarketing BOOLEAN NOT NULL DEFAULT false,
  ipHash TEXT,
  userAgent TEXT,
  source TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verifiedAt DATETIME
);

-- Create index on createdAt for sorting and filtering
CREATE INDEX idx_waitlist_createdAt ON Waitlist(createdAt);



