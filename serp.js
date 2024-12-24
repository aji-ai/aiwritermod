const { getModel, openaiClient, SUMMARY_MAX_TOKENS } = require("./api");
const { logger } = require("./logger")
const cheerio = require("cheerio");
const google = require("googlethis");
const path = require("path");
const fs = require("fs");

const queryDdg = async (keyword) => {
  const url = `https://html.duckduckgo.com/html/?q=${keyword}`;
  const html = await fetch(url);
  const text = await html.text();
  const $ = cheerio.load(text);
  const weirdUrls = $(".result__a").slice(0, 5).map((i, el) => {
    return $(el);
  }).toArray();

  const urls = weirdUrls.map((cheerioEl) => {
    const url = cheerioEl.attr("href");
    const urlObj = new URL(`https:` + url);
    return {
      title: cheerioEl.text(),
      url: urlObj.searchParams.get("uddg"),
    };
  });

  return urls;
};

const queryGoogle = async (keyword) => {
  const search = await google.search(keyword);
  return search.results.slice(0, 5);
};

const summarizeContent = async (url) => {
  const summaryModel = process.env.SUMMARY_MODEL || 'gpt-4o';
  logger.info(`SUMMARIZING with ${summaryModel} ...`);

  let html;
  try {
    html = await fetch(url);
  } catch (e) {
    logger.info(`Error fetching ${url}. Skipping...`);
    return null;
  }

  const text = await html.text();
  const $ = cheerio.load(text);
  const body = $("h1, h2, h3, h4, h5, h6, p");

  const content = body.text().slice(0, 14000);

  // Common summary prompt for all models
  const summaryPrompt = `TASK: Create a detailed summary of the provided content.

OUTPUT REQUIREMENTS:
1. Extract key facts and events with their exact source
2. Preserve important quotes verbatim with attribution
3. Include specific dates and numbers exactly as stated
4. Maintain original context without inference
5. Focus on concrete details over analysis
6. For biographical information:
   - Only include facts explicitly stated in the source
   - Do not make assumptions about education, affiliations, or career paths
   - If information is unclear or missing, explicitly state that
   - Use qualifying language like "according to [source]" for each claim

CONTENT TO SUMMARIZE:
${content}`;

  // Handle Anthropic models
  if (summaryModel.startsWith('claude-')) {
    const { anthropicClient, getAnthropicModelId } = require('./anthropic');
    const fullModelId = getAnthropicModelId(summaryModel);
    logger.info(`Using Anthropic model: ${fullModelId} for summarization`);
    
    try {
      const response = await anthropicClient.messages.create({
        model: fullModelId,
        max_tokens: SUMMARY_MAX_TOKENS,
        messages: [{
          role: 'user',
          content: summaryPrompt
        }]
      });

      const usage = {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens
      };

      const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, summaryModel);

      return {
        content: response.content,
        source: url,
        usage,
        cost
      };
    } catch (error) {
      logger.error(`Error in Anthropic summarization:`, error);
      return null;
    }
  }

  // Handle OpenAI models
  // Handle OpenAI models
  let messages;
  if (summaryModel.startsWith('o1')) {
    messages = [{
      role: "user",
      content: `You are an expert at creating concise, accurate summaries. Focus on extracting key facts and maintaining original context without inference or assumptions.

${summaryPrompt}`
    }];
  } else {
    messages = [{
      role: "system",
      content: "You are an expert at creating concise, accurate summaries. Focus on extracting key facts and maintaining original context without inference or assumptions."
    }, {
      role: "user",
      content: summaryPrompt
    }];
  }
  
  try {
    const completionOptions = {
      model: summaryModel,
      messages
    };

    // Add different token limits and temperature based on model type
    if (summaryModel.startsWith('o1')) {
      completionOptions.max_completion_tokens = SUMMARY_MAX_TOKENS;
    } else {
      completionOptions.max_tokens = SUMMARY_MAX_TOKENS;
      completionOptions.temperature = 0.3;  // Keep low temperature for non-o1 models
    }

    const response = await openaiClient.chat.completions.create(completionOptions);

    const usage = response.usage;
    const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, summaryModel);

    return {
      content: response.choices[0].message.content,
      source: url,
      usage,
      cost
    };
  } catch (error) {
    logger.error(`Error summarizing content: ${error}`);
    return null;
  }
};

const queryLocalDir = async (keyword, sourceDir) => {
  const dirPath = path.join('./sources', sourceDir);
  const results = [];
  
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath, 'utf-8');
        results.push({
          title: file,
          content: content,
          isLocal: true
        });
      }
    }
  } catch (e) {
    logger.error(`Error reading local directory ${dirPath}: ${e.message}`);
  }
  
  return results;
};

const calculateCost = (inputTokens, outputTokens, model) => {
  const rates = {
    'gpt-4o': {
      input: 2.50 / 1000000,
      output: 10.00 / 1000000
    },
    'gpt-4o-mini': {
      input: 0.150 / 1000000,
      output: 0.600 / 1000000
    },
    'o1-mini': {
      input: 3.00 / 1000000,
      output: 12.00 / 1000000
    },
    'claude-3-5-sonnet': {
      input: 3.00 / 1000000,
      output: 15.00 / 1000000
    },
    'claude-3-5-haiku': {
      input: 0.80 / 1000000,
      output: 4.00 / 1000000
    },
    'claude-3-sonnet': {
      input: 3.00 / 1000000,
      output: 15.00 / 1000000
    },
    'claude-3-haiku': {
      input: 0.25 / 1000000,
      output: 1.25 / 1000000
    }
  };

  if (!rates[model]) {
    logger.warn(`Unknown model ${model}, defaulting to gpt-4o rates`);
  }
  const rate = rates[model] || rates['gpt-4o'];
  
  return {
    inputCost: inputTokens * rate.input,
    outputCost: outputTokens * rate.output,
    totalCost: (inputTokens * rate.input) + (outputTokens * rate.output)
  };
};

module.exports = {
  queryGoogle,
  queryDdg,
  summarizeContent,
  queryLocalDir,
  calculateCost
};
