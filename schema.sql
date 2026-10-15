-- Worker ilk istekte tabloları kendisi oluşturur; bu dosya yalnızca başvuru içindir.
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,          -- fotoğrafın yüklendiği an (UTC, ISO 8601)
  sys INTEGER NOT NULL,              -- büyük tansiyon
  dia INTEGER NOT NULL,              -- küçük tansiyon
  pulse INTEGER,                     -- nabız
  meal TEXT,                         -- 'ac' | 'tok' | NULL
  note TEXT,
  lat REAL, lon REAL, accuracy REAL,
  place TEXT,                        -- semt / ilçe, il
  temp_c REAL, humidity REAL, weather_code INTEGER,
  source TEXT,                       -- 'foto' | 'foto+elle' | 'elle'
  ocr_confidence TEXT,
  ocr_raw TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  photo BLOB,
  photo_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_created ON readings(created_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
