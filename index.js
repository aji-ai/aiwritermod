const logger = require("pino")();
require("dotenv").config();
const cheerio = require("cheerio");
const fs = require("fs");
const google = require("googlethis");
const openai = require("openai");
const wordcount = require("word-count");
const { execSync } = require("child_process");
const { serve } = require("@hono/node-server");
const { Hono } = require("hono");

const client = new openai.OpenAI(process.env.OPENAI_API_KEY);

const model = process.env.OPENAI_MODEL || "gpt-4-1106-preview";

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
    return;
  }

  const text = await html.text();

  const $ = cheerio.load(text);
  const body = $("h1, h2, h3, h4, h5, h6, p");

  const content = `
    Parse the output of the following HTML and return the content of the article.

    ${body.text().slice(0, 14000)}
  `;

  const example = `
    Title: (title of page)
    
    Summary:
      - Heading 1
        - Heading 2
          - (content)
        - Heading 2
          - Heading 3
            - (content)
  `;

  const messages = [
    {
      role: "system",
      content:
        "Act as a helpful program that can accurately return the contents of an article.",
    },
    {
      role: "user",
      content:
        "Parse the output of the following HTML and return the content of the article.",
    },
    { role: "assistant", content: example },
    { role: "user", content },
  ];

  const response = await client.chat.completions.create({
    model,
    messages,
  });

  return response.choices[0].message;
};

const generateTitles = async (keyword) => {
  const content = `
    Generate 10 SEO-optimized titles for the following keyword: ${keyword}.
  `;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "user", content },
    ],
  });

  const message = response.choices[0].message;
  return message.content;
};

const generateArticle = async (topic, summaries) => {
  const summariesAsText = summaries.filter((s) => !!s).map((summary) =>
    summary.content
  );

  const currentToken = 0;

  const minimumWordCount = 1700;

  const content = `
    Write an article about the following topic: ${topic}. 

    Use the following contents of similar articles to construct the article. Do not repeat the same content. Use a tone that is appropriate for a blog post. The article should be SEO-optimized. The article must be more than ${minimumWordCount} words. It must be formatted as Markdown.
    
    In the introductory paragraph, introduce the topic and the main points of the article. Also, declaratively answer any questions that the reader may have in a format that is Google SEO-friendly. Generate Markdown links as often as possible for anything that should be linked to. You must generate at least one Markdown link in the first two paragraphs linking to the concept or project.

    You must always provide the following things in the blog post:

    - Key takeaways
    - A declarative answer to the question "(topic)?"
    - A step-by-step guide to (topic)
    - Who is (topic) for?
    
    In the body, elaborate on the main points. Each section indicated by an h2 header must contain at least 100 words. In the conclusion, summarize the main points and provide a call to action.

    The blog post will be longer than you are able to generate in a single request. Generate the article in increments of 1000 tokens. Start at token ${currentToken}. When you are done, add the text "$COMPLETED" to the end of the article.

    ${summariesAsText.join("\n")}

    Do not repeat any of the content you have already generated. If you do, you will be penalized.
  `;

  let finalContent = "";

  while (wordcount(finalContent) < minimumWordCount) {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            `Act as a writer creating SEO-optimized articles for a blog. You must generate at least ${
              minimumWordCount - wordcount(finalContent)
            } more words.`,
        },
        { role: "user", content },
      ],
    });

    const message = response.choices[0].message;

    finalContent += message.content;

    if (message.content.includes("$COMPLETED")) {
      break;
    }

    logger.info(`${wordcount(finalContent)} words generated, continuing...`);
  }

  finalContent = finalContent.replace("$COMPLETED", "");

  return finalContent;
};

const readKeywords = () => {
  const files = fs.readdirSync("./keywords");
  return files;
};

const main = async (keyword) => {
  if (!keyword) {
    logger.info("Please provide a keyword");
    return;
  }

  logger.info(`Processing keyword: ${keyword}`);

  // const results = await queryGoogle(keyword);
  const results = await queryDdg(keyword);

  if (results.length === 0) {
    logger.info(
      "No results found. Something might be wrong with this keyword. Skipping...",
    );
    return;
  }

  let summaries = [];

  for (const result of results) {
    logger.info(`PROCESSING "${result.title} - ${result.url}"`);
    const summary = await summarizeContent(result.url);
    summaries.push(summary);
  }
  logger.info(`Summarized ${summaries.length} articles. Generating article...`);

  const article = await generateArticle(keyword, summaries);
  logger.info(`Article generated. ${wordcount(article)} words`);

  const titles = await generateTitles(keyword);
  logger.info(`Titles generated: \n${titles}`);

  const fileContent = `
    ${titles} 

    ${article}
  `;

  fs.writeFileSync(`./articles/${keyword}.md`, fileContent);
  logger.info(`Article saved to ./articles/${keyword}.md`);

  logger.info(`Deleting keyword file`);
  fs.unlinkSync(`./keywords/${keyword}`);

  logger.info("DONE");
};

const run = async () => {
  const keywords = readKeywords();
  await main(keywords[0]);
  execSync("sleep 5");
  run();
};

run();

// const app = new Hono();
// app.get("/", async (c) => {
//   const keyword = c.req.query("keyword");
//   if (!keyword) {
//     return c.throw(400, "Please provide a keyword");
//   }
//
//   const result = await main(keyword);
//   return c.json(result);
// });
//
// const port = process.env.PORT || "5129";
//
// serve({
//   fetch: app.fetch,
//   port,
// });
//
// console.log(`Listening on port ${port}`);
