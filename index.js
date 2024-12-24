const { execSync } = require("child_process");
const fs = require("fs");

require("dotenv").config();

const wordcount = require("word-count");

const { getModel, openaiClient } = require("./api");
const { generateArticle, generateTitles } = require("./gen");
const { logger } = require("./logger")
const { queryDdg, summarizeContent, queryLocalDir } = require("./serp");

const { serve } = require("@hono/node-server");
const { Hono } = require("hono");

const main = async (keyword, options = {}) => {
  const { sourceDir = null, model: customModel = null } = options;
  const activeModel = customModel || getModel();
  const summaryModel = process.env.SUMMARY_MODEL || 'gpt-4o';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let totalSummaryInputTokens = 0;
  let totalSummaryOutputTokens = 0;
  let totalSummaryCost = 0;

  if (!keyword) {
    throw new Error("Please provide a keyword");
  }

  logger.info(`Processing keyword: ${keyword}`);

  let results = [];
  
  // Always perform web search unless explicitly disabled
  logger.info("Performing web search...");
  results = await queryDdg(keyword);
  
  // Add local sources if sourceDir is provided
  if (sourceDir) {
    logger.info("Processing local sources...");
    const localResults = await queryLocalDir(keyword, sourceDir);
    results = [...results, ...localResults];
  }

  if (results.length === 0) {
    throw new Error("No results found. Please check your sources or keyword.");
  }

  let summaries = [];
  for (const result of results) {
    if (result.isLocal) {
      logger.info(`PROCESSING LOCAL "${result.title}"`);
      summaries.push({ 
        content: result.content,
        isLocal: true 
      });
    } else {
      logger.info(`PROCESSING WEB "${result.title} - ${result.url}"`);
      const summary = await summarizeContent(result.url);
      if (summary?.usage) {
        totalSummaryInputTokens += summary.usage.prompt_tokens;
        totalSummaryOutputTokens += summary.usage.completion_tokens;
        if (summary.cost) totalSummaryCost += summary.cost.totalCost;
      }
      summaries.push({
        ...summary,
        isLocal: false 
      });
    }
  }
  logger.info(`Summarized ${summaries.length} articles. Generating article...`);

  const article = await generateArticle(keyword, summaries, activeModel, totalSummaryInputTokens, totalSummaryOutputTokens);
  if (article?.usage) {
    totalInputTokens += article.usage.prompt_tokens;
    totalOutputTokens += article.usage.completion_tokens;
    if (article.cost) totalCost += article.cost.totalCost;
  }
  totalSummaryInputTokens = article.totalSummaryInputTokens;
  totalSummaryOutputTokens = article.totalSummaryOutputTokens;

  // const fileContent = typeof article.content === 'string' ? article.content : JSON.stringify(article.content, null, 2);

  // if (fileContent === '[object Object]') {
  //   logger.error('Article content is not a valid string. Skipping file write.');
  // } else {
  //   fs.writeFileSync(`./articles/${keyword}.md`, article.content);
  //   logger.info(`Article saved to ./articles/${keyword}.md`);
  // }
  // const fileContent = `${article.content}`;
  // fs.writeFileSync(`./articles/${keyword}.md`, fileContent);
  // const fileContent = typeof article.content === 'string' ? article.content : JSON.stringify(article.content, null, 2);
  // fs.writeFileSync(`./articles/${keyword}.md`, fileContent);
  // logger.info(`Article saved to ./articles/${keyword}.md`);

  const fileContent = Array.isArray(article.content) 
  ? article.content.map(item => item.text).join('\n') 
  : article.content;
fs.writeFileSync(`./articles/${keyword}.md`, fileContent);
logger.info(`Article saved to ./articles/${keyword}.md`);

  logger.info(`DONE - Usage Summary:
    Models: Article - ${activeModel}, Summary - ${summaryModel}
    Tokens: Article - ${totalInputTokens}/${totalOutputTokens}, Summary - ${totalSummaryInputTokens}/${totalSummaryOutputTokens}
    Total Tokens: Article - ${totalInputTokens + totalOutputTokens}, Summary - ${totalSummaryInputTokens + totalSummaryOutputTokens}
    Costs: Article - $${totalCost.toFixed(4)}, Summary - $${totalSummaryCost.toFixed(4)}, Total - $${(totalCost + totalSummaryCost).toFixed(4)}
  `);

  return {
    keyword,
    article,
    usage: {
      model: activeModel,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost: totalCost
    }
  };
};

const run = async () => {
  const keywords = readKeywords();
  await main(keywords[0]);
  execSync("sleep 5");
  run();
};

const app = new Hono();
app.get("/", async (c) => {
  try {
    const keywordParam = c.req.query("keyword");
    const sourceDir = c.req.query("source_dir");
    const modelParam = c.req.query("model");
    
    if (!keywordParam) {
      return c.json({ 
        error: "Please provide at least one keyword" 
      }, 400);
    }

    const keywords = keywordParam.split(',').map(k => k.trim());
    const results = [];
    
    for (const keyword of keywords) {
      try {
        const result = await main(keyword, { 
          sourceDir, 
          model: modelParam
        });
        results.push(result);
      } catch (err) {
        results.push({
          keyword,
          error: err.message
        });
      }
    }

    return c.json(results);
  } catch (err) {
    return c.json({ 
      error: err.message 
    }, 500);
  }
});

const port = process.env.PORT || "5139";

serve({
  fetch: app.fetch,
  port,
});

console.log(`Listening on port ${port}`);

module.exports = { logger }
