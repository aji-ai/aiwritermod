const openai = require("openai");
const openaiClient = new openai.OpenAI(process.env.OPENAI_API_KEY);

const getModel = (customModel) => customModel || process.env.OPENAI_MODEL || "gpt-4o";

const TITLE_MAX_TOKENS = parseInt(process.env.TITLE_MAX_TOKENS) || 200;
const ARTICLE_MAX_TOKENS = parseInt(process.env.ARTICLE_MAX_TOKENS) || 4000;
const SUMMARY_MAX_TOKENS = parseInt(process.env.SUMMARY_MAX_TOKENS) || 1000;

module.exports = {
  openaiClient,
  getModel,
  TITLE_MAX_TOKENS,
  ARTICLE_MAX_TOKENS,
  SUMMARY_MAX_TOKENS
};
