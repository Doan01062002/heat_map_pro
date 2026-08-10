-- ==============================================================================
-- Migration 02: AI Investigation Columns & Log Table
-- ==============================================================================

-- Add AI classification columns to deviation_events table
ALTER TABLE deviation_events
  ADD COLUMN IF NOT EXISTS risk_label VARCHAR(30) DEFAULT 'unclassified',
  ADD COLUMN IF NOT EXISTS ai_confidence REAL DEFAULT 0;

-- Table to store AI investigation history
CREATE TABLE IF NOT EXISTS ai_investigations (
    id              BIGSERIAL        PRIMARY KEY,
    h3_index        VARCHAR(20)      NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    risk_level      VARCHAR(30)      NOT NULL,
    confidence      REAL             NOT NULL,
    summary         TEXT             NOT NULL,
    evidence_json   JSONB            NOT NULL DEFAULT '{}'::jsonb,
    recommendation  TEXT,
    location_name   VARCHAR(256),
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_investigations_h3
    ON ai_investigations (h3_index, created_at DESC);
