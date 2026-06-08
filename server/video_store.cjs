/* video_store.cjs - 素材库后端兼容入口 */
const path = require('path');
const createMaterialsDb = require('./materials/db.cjs');
const media = require('./materials/media.cjs');
const createMaterialClassifier = require('./materials/classifier.cjs');
const createMaterialRoutes = require('./materials/routes.cjs');
const createLlmRuntime = require('./lib/llm.cjs');
const createInternalFileStore = require('./lib/internalFileStore.cjs');

const APP_ROOT = path.join(__dirname, '..');
const ROOT = process.env.USAGI_RUNTIME_ROOT || APP_ROOT;
require('./env.cjs').loadEnv(APP_ROOT);

const UPLOAD_DIR = path.join(ROOT, 'public', 'uploads');
const THUMB_DIR = path.join(ROOT, 'public', 'uploads', 'thumbs');
const DATA_DIR = path.join(ROOT, 'data');

media.ensureDirs([
  path.join(UPLOAD_DIR, 'video'),
  path.join(UPLOAD_DIR, 'bgm'),
  path.join(UPLOAD_DIR, 'image'),
  THUMB_DIR,
  DATA_DIR
]);

const materialsDb = createMaterialsDb({
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'materials.db')
});

const llmRuntime = createLlmRuntime({
  root: ROOT,
  sfKey: process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || ''
});

const classifier = createMaterialClassifier({
  siliconflowKey: process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '',
  callMiniMaxChat: llmRuntime.callMiniMaxChat
});

const internalFileStore = createInternalFileStore({
  token: process.env.INTERNAL_FILE_TOKEN || process.env.FILE_MANAGER_TOKEN || '',
  servers: process.env.INTERNAL_FILE_SERVERS || process.env.FILE_MANAGER_BASE_URLS || '',
  chunkSize: process.env.INTERNAL_FILE_CHUNK_SIZE || process.env.FILE_MANAGER_CHUNK_SIZE || ''
});

const materialRoutes = createMaterialRoutes({
  root: ROOT,
  uploadDir: UPLOAD_DIR,
  thumbDir: THUMB_DIR,
  db: materialsDb.getDb(),
  media: media,
  classifier: classifier,
  internalFileStore: internalFileStore
});

materialRoutes._db = materialsDb.getDb();
materialRoutes._uploadDir = UPLOAD_DIR;
materialRoutes._thumbDir = THUMB_DIR;

module.exports = materialRoutes;
