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
  const activeModel = getModel();

  const content = `
    Helpfully summarize the following content:

    ${body.text().slice(0, 14000)}
  `;

  const messages = [];
  
  if (activeModel.startsWith('o1')) {
    messages.push({
      role: "user",
      content: `TASK: Create a detailed summary of the provided content.

OUTPUT REQUIREMENTS:
1. Extract key facts and events
2. Preserve important quotes verbatim
3. Include specific dates and numbers
4. Maintain original context
5. Focus on concrete details over analysis

CONTENT TO SUMMARIZE:
${content}

Begin the summary now:`
    });
  } else {
    messages.push({
      role: "system",
      content: "You are an expert at creating engaging web content that makes complex topics accessible while maintaining accuracy. Only use information explicitly stated in the provided sources. Do not make assumptions or add information not present in the sources. If dates or specific details are unclear, use qualifying language or omit them."
    });
    messages.push({
      role: "user",
      content: `Write an engaging web article about ${topic}.

Key requirements:
- Use clear, accessible language
- Include relevant quotes from sources with proper attribution
- Only include dates and facts that are explicitly mentioned in the sources
- If uncertain about specific details, use phrases like "around" or "approximately"
- Structure for web readability
- Minimum ${minimumWordCount} words
- Format in Markdown
- End with practical takeaways
- Each major claim should reference which source it came from

SOURCE MATERIALS:
${sourceMaterials}`
    });
  }

  try {
    const response = await openaiClient.chat.completions.create({
      model: activeModel,
      messages,
      max_completion_tokens: SUMMARY_MAX_TOKENS
    });

    const usage = response.usage;
    const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, activeModel);

    logger.info(`Web content summarization tokens used: ${JSON.stringify({
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      model: activeModel,
      estimated_cost: cost.totalCost
    })}`);

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
      input: 2.50 / 1000000,  // $2.50 per 1M tokens
      output: 10.00 / 1000000 // $10.00 per 1M tokens
    },
    'gpt-4o-mini': {
      input: 0.150 / 1000000,  // $0.150 per 1M tokens
      output: 0.600 / 1000000  // $0.600 per 1M tokens
    },
    'o1-mini': {
      input: 3.00 / 1000000,   // $3.00 per 1M tokens
      output: 12.00 / 1000000  // $12.00 per 1M tokens
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
