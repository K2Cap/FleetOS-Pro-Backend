const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const { buildPayloadFromText } = require('./local-ocr');
const { flattenOcrPayload } = require('./ocr-normalizers');
const { preprocessForOcr } = require('./image-preprocess');

function readCredentialsFromEnv() {
  if (process.env.DOCUMENT_AI_CREDENTIALS_JSON) {
    try {
      return JSON.parse(process.env.DOCUMENT_AI_CREDENTIALS_JSON);
    } catch (err) {
      throw new Error(`Invalid DOCUMENT_AI_CREDENTIALS_JSON: ${err.message}`);
    }
  }

  if (process.env.DOCUMENT_AI_CREDENTIALS_BASE64) {
    try {
      const json = Buffer.from(process.env.DOCUMENT_AI_CREDENTIALS_BASE64, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch (err) {
      throw new Error(`Invalid DOCUMENT_AI_CREDENTIALS_BASE64: ${err.message}`);
    }
  }

  return null;
}

function getDocumentAiConfig() {
  const projectId = process.env.DOCUMENT_AI_PROJECT_ID;
  const location = process.env.DOCUMENT_AI_LOCATION || 'us';
  const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
  const credentials = readCredentialsFromEnv();

  return {
    projectId,
    location,
    processorId,
    credentials,
    enabled: !!(projectId && location && processorId),
  };
}

let cachedClient = null;
let cachedKey = null;

function getDocumentAiClient() {
  const config = getDocumentAiConfig();
  if (!config.enabled) {
    throw new Error('Document AI is not configured');
  }

  const cacheKey = JSON.stringify({
    projectId: config.projectId,
    location: config.location,
    processorId: config.processorId,
    hasInlineCredentials: !!config.credentials,
  });

  if (cachedClient && cachedKey === cacheKey) return cachedClient;

  const options = {
    apiEndpoint: `${config.location}-documentai.googleapis.com`,
  };
  if (config.credentials) {
    options.credentials = config.credentials;
  }

  cachedClient = new DocumentProcessorServiceClient(options);
  cachedKey = cacheKey;
  return cachedClient;
}

async function tryDocumentAiOcr(base64Image, mimeType = 'image/jpeg', documentType = 'logistics') {
  const config = getDocumentAiConfig();
  if (!config.enabled) {
    throw new Error('Document AI is not configured');
  }

  const prepared = await preprocessForOcr(base64Image, mimeType);
  const client = getDocumentAiClient();
  const name = `projects/${config.projectId}/locations/${config.location}/processors/${config.processorId}`;

  const [result] = await client.processDocument({
    name,
    rawDocument: {
      content: prepared.base64,
      mimeType: prepared.mimeType,
    },
  });

  const text = result?.document?.text || '';
  if (!text || text.trim().length < 8) {
    throw new Error('Document AI returned insufficient text');
  }

  const payload = buildPayloadFromText(text, documentType);
  payload._source = 'DocumentAI';
  payload._rawText = text;
  payload._engine = 'documentai';
  return flattenOcrPayload(payload);
}

module.exports = {
  getDocumentAiConfig,
  tryDocumentAiOcr,
};
